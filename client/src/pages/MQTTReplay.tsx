import { useState, useEffect, useRef, useMemo } from 'react';
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, StatusBadge } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MACHINE_TYPES } from "@/constants/machineTypes";
import {
  Play,
  Pause, 
  SkipForward, 
  SkipBack, 
  RefreshCw,
  Search,
  Filter,
  Download,
  Clock,
  Radio,
  MessageSquare,
  Cpu,
  Plus,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { io, Socket } from "socket.io-client";
import { useTranslation } from 'react-i18next';

interface MqttMessage {
  topic: string;
  payload: any;
  timestamp: Date;
  machineCode?: string;
}

interface DiscoveredMachine {
  machineCode: string;
  topic: string;
  firstSeen: Date;
  lastSeen: Date;
  messageCount: number;
  samplePayload?: any;
}

export function MQTTReplayContent() {
  const { t } = useTranslation();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [liveMessages, setLiveMessages] = useState<MqttMessage[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [filterTopic, setFilterTopic] = useState("");
  const [filterMachine, setFilterMachine] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<MqttMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Register-discovered-machine dialog state (wired to machine.create)
  const [registerOpen, setRegisterOpen] = useState(false);
  const [regCode, setRegCode] = useState("");
  const [regName, setRegName] = useState("");
  const [regType, setRegType] = useState<(typeof MACHINE_TYPES)[number]>("AUTOMATION");
  const [regStationId, setRegStationId] = useState<number | undefined>(undefined);

  // Queries
  const { data: messageHistory, refetch: refetchHistory } = trpc.mqttClient.messageHistory.useQuery({
    topic: filterTopic || undefined,
    machineCode: filterMachine || undefined,
    limit: 100,
  });
  const { data: discoveredMachines, refetch: refetchDiscovered } = trpc.mqttClient.discoveredMachines.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: stations } = trpc.station.list.useQuery();
  const utils = trpc.useUtils();

  // Create a real machine record from a discovered MQTT device.
  const registerMachineMutation = trpc.machine.create.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.replayPage.registerSuccess', { code: regCode, defaultValue: 'Machine {{code}} registered' }));
      setRegisterOpen(false);
      utils.machine.list.invalidate();
      refetchDiscovered();
    },
    onError: (err) => {
      toast.error(t('mqtt.replayPage.registerError', 'Failed to register machine'), { description: err.message });
    },
  });

  const handleOpenRegister = (machine: DiscoveredMachine) => {
    setRegCode(machine.machineCode);
    setRegName(machine.machineCode);
    setRegType("AUTOMATION");
    setRegStationId(stations && stations.length > 0 ? stations[0].id : undefined);
    setRegisterOpen(true);
  };

  const handleRegisterSubmit = () => {
    if (!regStationId || !regCode.trim() || !regName.trim()) return;
    registerMachineMutation.mutate({
      stationId: regStationId,
      code: regCode.trim(),
      name: regName.trim(),
      machineType: regType,
    });
  };

  // Socket.io connection for live messages
  useEffect(() => {
    const socketInstance = io({
      path: "/api/socket.io",
      transports: ["websocket"],
    });

    socketInstance.on("connect", () => {
      console.log("[MQTT Replay] Socket connected");
      setConnected(true);
      socketInstance.emit("subscribe", {});
    });

    socketInstance.on("disconnect", () => {
      console.log("[MQTT Replay] Socket disconnected");
      setConnected(false);
    });

    socketInstance.on("mqtt:message", (message: MqttMessage) => {
      if (isPlaying) {
        setLiveMessages((prev) => {
          const newMessages = [...prev, { ...message, timestamp: new Date(message.timestamp) }];
          // Keep only last 500 messages
          return newMessages.slice(-500);
        });
      }
    });

    socketInstance.on("machine:discovered", (machine: DiscoveredMachine) => {
      toast.info(t('mqtt.replayPage.newMachineDetected', { code: machine.machineCode, topic: machine.topic }));
      refetchDiscovered();
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [isPlaying, refetchDiscovered]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current && isPlaying) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveMessages, isPlaying]);

  // Filter live messages
  const filteredLiveMessages = liveMessages.filter((msg) => {
    if (filterTopic && !msg.topic.includes(filterTopic)) return false;
    if (filterMachine && msg.machineCode !== filterMachine) return false;
    return true;
  });

  // Export messages to JSON
  const exportMessages = () => {
    const data = JSON.stringify(filteredLiveMessages, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mqtt-messages-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('mqtt.replayPage.messagesExported', { count: filteredLiveMessages.length }));
  };

  // Format payload for display
  const formatPayload = (payload: any): string => {
    if (typeof payload === "string") {
      try {
        return JSON.stringify(JSON.parse(payload), null, 2);
      } catch {
        return payload;
      }
    }
    return JSON.stringify(payload, null, 2);
  };

  return (
    <>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<Radio className="h-6 w-6" />}
          title={t('mqtt.replayPage.title', 'MQTT Message Replay')}
          description={t('mqtt.replayPage.pageDesc')}
          actions={
            <StatusBadge
              status={connected ? "connected" : "disconnected"}
              tone={connected ? "success" : "error"}
              label={connected ? t('mqtt.replayPage.connected') : t('mqtt.replayPage.disconnected')}
              className="gap-1"
            />
          }
        />

        <Tabs defaultValue="live" className="space-y-4">
          <TabsList>
            <TabsTrigger value="live" className="gap-2">
              <Radio className="h-4 w-4" />
              {t('mqtt.replayPage.liveStream', 'Live Stream')}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <Clock className="h-4 w-4" />
              {t('mqtt.replayPage.historyTab', 'History')}
            </TabsTrigger>
            <TabsTrigger value="discovery" className="gap-2">
              <Cpu className="h-4 w-4" />
              {t('mqtt.replayPage.autoDiscoveryTab', 'Auto-Discovery')}
            </TabsTrigger>
          </TabsList>

          {/* Live Stream Tab */}
          <TabsContent value="live" className="space-y-4">
            {/* Controls */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant={isPlaying ? "default" : "outline"}
                      size="sm"
                      onClick={() => setIsPlaying(!isPlaying)}
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="h-4 w-4 mr-1" /> {t('mqtt.replayPage.pause', 'Pause')}
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-1" /> {t('mqtt.replayPage.play', 'Play')}
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLiveMessages([])}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" /> {t('common.clear', 'Clear')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportMessages}>
                      <Download className="h-4 w-4 mr-1" /> {t('common.export', 'Export')}
                    </Button>
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={t('mqtt.replayPage.filterByTopic', 'Filter by topic...')}
                      value={filterTopic}
                      onChange={(e) => setFilterTopic(e.target.value)}
                      className="w-48"
                    />
                    <Select value={filterMachine || 'all'} onValueChange={(v) => setFilterMachine(v === 'all' ? '' : v)}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder={t('mqtt.replayPage.allMachines', 'All machines')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('mqtt.replayPage.allMachines', 'All machines')}</SelectItem>
                        {machines?.map((m) => (
                          <SelectItem key={m.id} value={m.code || String(m.id)}>
                            {m.code || String(m.id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Message List */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    {t('mqtt.replayPage.messagesTitle', 'Messages')} ({filteredLiveMessages.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96" ref={scrollRef}>
                    <div className="space-y-2">
                      {filteredLiveMessages.map((msg) => (
                        <div
                          key={`${msg.timestamp}-${msg.topic}`}
                          className={`p-2 rounded border cursor-pointer transition-colors ${
                            selectedMessage === msg
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted/50"
                          }`}
                          onClick={() => setSelectedMessage(msg)}
                        >
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-mono text-xs text-muted-foreground">
                              {new Date(msg.timestamp).toLocaleTimeString("vi-VN")}
                            </span>
                            {msg.machineCode && (
                              <Badge variant="outline" className="text-xs">
                                {msg.machineCode}
                              </Badge>
                            )}
                          </div>
                          <div className="font-mono text-sm truncate mt-1">
                            {msg.topic}
                          </div>
                        </div>
                      ))}
                      {filteredLiveMessages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                          <Radio className="h-12 w-12 mb-4 animate-pulse" />
                          <p>{t('mqtt.replayPage.waitingMessages')}</p>
                          <p className="text-sm mt-2">
                            {isPlaying ? t('mqtt.replayPage.streamRunning') : t('mqtt.replayPage.streamPaused')}
                          </p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Message Detail */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{t('mqtt.replayPage.messageDetail')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedMessage ? (
                    <div className="space-y-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">{t('mqtt.replayPage.topicLabel', 'Topic')}</Label>
                        <p className="font-mono text-sm break-all">{selectedMessage.topic}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">{t('mqtt.replayPage.timestampLabel', 'Timestamp')}</Label>
                        <p className="text-sm">
                          {new Date(selectedMessage.timestamp).toLocaleString("vi-VN")}
                        </p>
                      </div>
                      {selectedMessage.machineCode && (
                        <div>
                          <Label className="text-xs text-muted-foreground">{t('mqtt.replayPage.machineCodeLabel', 'Machine Code')}</Label>
                          <p className="text-sm">{selectedMessage.machineCode}</p>
                        </div>
                      )}
                      <div>
                        <Label className="text-xs text-muted-foreground">{t('mqtt.replayPage.payloadLabel', 'Payload')}</Label>
                        <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-48">
                          {formatPayload(selectedMessage.payload)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <Search className="h-12 w-12 mb-4" />
                      <p>{t('mqtt.replayPage.selectMessage')}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('mqtt.replayPage.messageHistory')}</CardTitle>
                <CardDescription>
                  {t('mqtt.replayPage.messageHistoryDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 mb-4">
                  <Input
                    placeholder={t('mqtt.replayPage.filterByTopic', 'Filter by topic...')}
                    value={filterTopic}
                    onChange={(e) => setFilterTopic(e.target.value)}
                    className="w-64"
                  />
                  <Select value={filterMachine || 'all'} onValueChange={(v) => setFilterMachine(v === 'all' ? '' : v)}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder={t('mqtt.replayPage.allMachines', 'All machines')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('mqtt.replayPage.allMachines', 'All machines')}</SelectItem>
                      {machines?.map((m) => (
                        <SelectItem key={m.id} value={m.code || String(m.id)}>
                          {m.code || String(m.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => refetchHistory()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('common.refresh')}
                  </Button>
                </div>

                <ScrollArea className="h-96">
                  <div className="space-y-2">
                    {messageHistory?.map((msg) => (
                      <div
                        key={`${msg.timestamp}-${msg.topic}`}
                        className="p-3 rounded border hover:bg-muted/50 cursor-pointer"
                        onClick={() => setSelectedMessage(msg as MqttMessage)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm">{msg.topic}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(msg.timestamp).toLocaleString("vi-VN")}
                          </span>
                        </div>
                        {msg.machineCode && (
                          <Badge variant="outline" className="mt-1 text-xs">
                            {msg.machineCode}
                          </Badge>
                        )}
                      </div>
                    ))}
                    {(!messageHistory || messageHistory.length === 0) && (
                      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                        <Clock className="h-12 w-12 mb-4" />
                        <p>{t('mqtt.replayPage.noHistory')}</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Auto-Discovery Tab */}
          <TabsContent value="discovery" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  {t('mqtt.replayPage.machineAutoDiscovery', 'Machine Auto-Discovery')}
                </CardTitle>
                <CardDescription>
                  {t('mqtt.replayPage.autoDiscoveryDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex justify-end mb-4">
                  <Button variant="outline" onClick={() => refetchDiscovered()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('common.refresh')}
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {discoveredMachines?.map((machine) => {
                    const isRegistered = machines?.some((m) => m.code === machine.machineCode);
                    return (
                      <Card key={machine.machineCode} className="relative">
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h3 className="font-semibold">{machine.machineCode}</h3>
                              <p className="text-xs text-muted-foreground font-mono">
                                {machine.topic}
                              </p>
                            </div>
                            {isRegistered ? (
                              <StatusBadge status="registered" tone="success" label={t('mqtt.replayPage.registered')} />
                            ) : (
                              <StatusBadge status="new" tone="info" label={t('mqtt.replayPage.new')} />
                            )}
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t('mqtt.replayPage.firstDetected')}:</span>
                              <span>{new Date(machine.firstSeen).toLocaleString("vi-VN")}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t('mqtt.replayPage.lastSeen')}:</span>
                              <span>{new Date(machine.lastSeen).toLocaleString("vi-VN")}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t('mqtt.replayPage.messageCountLabel')}:</span>
                              <span>{machine.messageCount}</span>
                            </div>
                          </div>
                          {!isRegistered && (
                            <Button
                              size="sm"
                              className="w-full mt-3"
                              variant="outline"
                              onClick={() => handleOpenRegister(machine)}
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              {t('mqtt.replayPage.registerMachine')}
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                  {(!discoveredMachines || discoveredMachines.length === 0) && (
                    <div className="col-span-full flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <AlertCircle className="h-12 w-12 mb-4" />
                      <p>{t('mqtt.replayPage.noMachinesDetected')}</p>
                      <p className="text-sm mt-2">
                        {t('mqtt.replayPage.autoDetectInfo')}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Register discovered machine — calls machine.create (admin). Success
            toast fires ONLY on a real mutation success. */}
        <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('mqtt.replayPage.registerDialogTitle', 'Register Machine')}</DialogTitle>
              <DialogDescription>
                {t('mqtt.replayPage.registerDialogDesc', 'Create a machine record from this discovered MQTT device.')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('mqtt.replayPage.registerCodeLabel', 'Machine code')}</Label>
                <Input value={regCode} onChange={(e) => setRegCode(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>{t('mqtt.replayPage.registerNameLabel', 'Machine name')}</Label>
                <Input value={regName} onChange={(e) => setRegName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>{t('mqtt.replayPage.registerTypeLabel', 'Machine type')}</Label>
                <Select value={regType} onValueChange={(v) => setRegType(v as (typeof MACHINE_TYPES)[number])}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MACHINE_TYPES.map((mt) => (
                      <SelectItem key={mt} value={mt}>{mt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('mqtt.replayPage.registerStationLabel', 'Station')}</Label>
                <Select
                  value={regStationId ? String(regStationId) : ''}
                  onValueChange={(v) => setRegStationId(Number(v))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={t('mqtt.replayPage.registerStationPlaceholder', 'Select a station')} />
                  </SelectTrigger>
                  <SelectContent>
                    {stations?.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.code ? `${s.code} — ${s.name}` : s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(!stations || stations.length === 0) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('mqtt.replayPage.registerNoStations', 'No stations configured — create a station first.')}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRegisterOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleRegisterSubmit}
                disabled={
                  registerMachineMutation.isPending ||
                  !regStationId ||
                  !regCode.trim() ||
                  !regName.trim()
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('mqtt.replayPage.registerConfirm', 'Register')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContainer>
    </>
  );
}

export default function MQTTReplay() {
  return (
    <DashboardLayout>
      <MQTTReplayContent />
    </DashboardLayout>
  );
}
