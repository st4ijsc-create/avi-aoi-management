import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Radio, 
  MessageSquare, 
  Search, 
  Filter, 
  Download, 
  Play, 
  Pause,
  RefreshCw,
  Eye,
  Copy,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Inbox,
  Send,
} from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function MqttTopicsMessages() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("topics");
  const [searchTerm, setSearchTerm] = useState("");
  const [messageTypeFilter, setMessageTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isReplayOpen, setIsReplayOpen] = useState(false);
  const [replayMessage, setReplayMessage] = useState<any>(null);

  // Fetch message logs
  const { data: messageLogs = [], isLoading: loadingMessages, refetch: refetchMessages } = 
    trpc.mqttClient.messageLogs.useQuery({ limit: 200 });

  // Fetch recent messages
  const { data: recentMessages = [], isLoading: loadingRecent } = 
    trpc.mqttClient.recentMessages.useQuery({ limit: 50 });

  // Fetch message trend
  const { data: messageTrend = [] } = trpc.mqttClient.messageTrend.useQuery({ days: 7 });

  // Group messages by topic
  const topicStats = useMemo(() => {
    const stats: Record<string, { count: number; lastMessage: Date | null; types: Set<string> }> = {};
    
    messageLogs.forEach((msg: any) => {
      const topic = msg.topic || 'unknown';
      if (!stats[topic]) {
        stats[topic] = { count: 0, lastMessage: null, types: new Set() };
      }
      stats[topic].count++;
      stats[topic].types.add(msg.messageType);
      if (!stats[topic].lastMessage || new Date(msg.createdAt) > stats[topic].lastMessage!) {
        stats[topic].lastMessage = new Date(msg.createdAt);
      }
    });
    
    return Object.entries(stats).map(([topic, data]) => ({
      topic,
      count: data.count,
      lastMessage: data.lastMessage,
      types: Array.from(data.types),
    })).sort((a, b) => b.count - a.count);
  }, [messageLogs]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    return messageLogs.filter((msg: any) => {
      const matchesSearch = !searchTerm || 
        msg.topic?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        JSON.stringify(msg.payload)?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesType = messageTypeFilter === "all" || msg.messageType === messageTypeFilter;
      const matchesStatus = statusFilter === "all" || msg.deliveryStatus === statusFilter;
      
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [messageLogs, searchTerm, messageTypeFilter, statusFilter]);

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleString("vi-VN");
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "DELIVERED":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "FAILED":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "PENDING":
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getMessageTypeColor = (type: string) => {
    switch (type) {
      case "NG_ALERT":
        return "destructive";
      case "DAILY_SUMMARY":
        return "default";
      case "WEEKLY_SUMMARY":
        return "secondary";
      case "CUSTOM":
        return "outline";
      default:
        return "outline";
    }
  };

  const handleViewMessage = (message: any) => {
    setSelectedMessage(message);
    setIsDetailOpen(true);
  };

  const handleReplayMessage = (message: any) => {
    setReplayMessage(message);
    setIsReplayOpen(true);
  };

  const handleCopyPayload = (payload: any) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast.success(t('mqtt.topicsMessages.payloadCopied'));
  };

  const handleExportMessages = () => {
    const exportData = filteredMessages.map((msg: any) => ({
      id: msg.id,
      topic: msg.topic,
      messageType: msg.messageType,
      deliveryStatus: msg.deliveryStatus,
      createdAt: msg.createdAt,
      payload: msg.payload,
    }));
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mqtt-messages-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('mqtt.topicsMessages.messagesExported'));
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">MQTT Topics & Messages</h1>
            <p className="text-muted-foreground">
              {t('mqtt.topicsMessages.pageDesc')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetchMessages()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('common.refresh')}
            </Button>
            <Button variant="outline" onClick={handleExportMessages}>
              <Download className="w-4 h-4 mr-2" />
              {t('mqtt.topicsMessages.exportJson')}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('mqtt.topicsMessages.totalTopics')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{topicStats.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('mqtt.topicsMessages.totalMessages')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{messageLogs.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Delivered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">
                {messageLogs.filter((m: any) => m.deliveryStatus === "DELIVERED").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Failed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">
                {messageLogs.filter((m: any) => m.deliveryStatus === "FAILED").length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="topics">
              <Radio className="w-4 h-4 mr-2" />
              Topics
            </TabsTrigger>
            <TabsTrigger value="messages">
              <MessageSquare className="w-4 h-4 mr-2" />
              Messages
            </TabsTrigger>
            <TabsTrigger value="recent">
              <Inbox className="w-4 h-4 mr-2" />
              Recent Activity
            </TabsTrigger>
          </TabsList>

          {/* Topics Tab */}
          <TabsContent value="topics" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Topic Statistics</CardTitle>
                <CardDescription>
                  {t('mqtt.topicsMessages.topicStats')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Topic</TableHead>
                      <TableHead>Message Count</TableHead>
                      <TableHead>Types</TableHead>
                      <TableHead>Last Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topicStats.map((stat) => (
                      <TableRow key={stat.topic}>
                        <TableCell className="font-mono text-sm">
                          {stat.topic}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{stat.count}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {stat.types.map((type) => (
                              <Badge 
                                key={type} 
                                variant={getMessageTypeColor(type) as any}
                                className="text-xs"
                              >
                                {type}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(stat.lastMessage)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {topicStats.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          {t('mqtt.noTopics')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder={t('mqtt.topicsMessages.searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <Select value={messageTypeFilter} onValueChange={setMessageTypeFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Message Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('mqtt.topicsMessages.allTypes')}</SelectItem>
                      <SelectItem value="NG_ALERT">NG Alert</SelectItem>
                      <SelectItem value="DAILY_SUMMARY">Daily Summary</SelectItem>
                      <SelectItem value="WEEKLY_SUMMARY">Weekly Summary</SelectItem>
                      <SelectItem value="CUSTOM">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('mqtt.topicsMessages.allStatus')}</SelectItem>
                      <SelectItem value="DELIVERED">Delivered</SelectItem>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="FAILED">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Messages Table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Topic</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingMessages ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">
                          {t('common.loading')}
                        </TableCell>
                      </TableRow>
                    ) : filteredMessages.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          {t('mqtt.topicsMessages.noMessages')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMessages.slice(0, 100).map((msg: any) => (
                        <TableRow key={msg.id}>
                          <TableCell>
                            {getStatusIcon(msg.deliveryStatus)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getMessageTypeColor(msg.messageType) as any}>
                              {msg.messageType}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm max-w-[300px] truncate">
                            {msg.topic}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDate(msg.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleViewMessage(msg)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleCopyPayload(msg.payload)}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleReplayMessage(msg)}
                              >
                                <Play className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Recent Activity Tab */}
          <TabsContent value="recent" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Messages</CardTitle>
                <CardDescription>
                  {t('mqtt.topicsMessages.recentMessages')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {loadingRecent ? (
                      <div className="text-center py-8 text-muted-foreground">
                        {t('common.loading')}
                      </div>
                    ) : recentMessages.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        {t('mqtt.topicsMessages.noMessages')}
                      </div>
                    ) : (
                      recentMessages.map((msg: any) => (
                        <div
                          key={msg.id}
                          className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                          onClick={() => handleViewMessage(msg)}
                        >
                          <div className="mt-1">
                            {getStatusIcon(msg.deliveryStatus)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={getMessageTypeColor(msg.messageType) as any} className="text-xs">
                                {msg.messageType}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(msg.createdAt)}
                              </span>
                            </div>
                            <p className="text-sm font-mono truncate">
                              {msg.topic}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Message Detail Dialog */}
        <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Message Detail</DialogTitle>
              <DialogDescription>
                {t('mqtt.topicsMessages.messageDetail')}
              </DialogDescription>
            </DialogHeader>
            {selectedMessage && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Type</Label>
                    <div className="mt-1">
                      <Badge variant={getMessageTypeColor(selectedMessage.messageType) as any}>
                        {selectedMessage.messageType}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Status</Label>
                    <div className="mt-1 flex items-center gap-2">
                      {getStatusIcon(selectedMessage.deliveryStatus)}
                      <span>{selectedMessage.deliveryStatus}</span>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-muted-foreground">Topic</Label>
                    <p className="mt-1 font-mono text-sm bg-muted p-2 rounded">
                      {selectedMessage.topic}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Created At</Label>
                    <p className="mt-1">{formatDate(selectedMessage.createdAt)}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Delivered At</Label>
                    <p className="mt-1">{formatDate(selectedMessage.deliveredAt)}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Payload</Label>
                  <ScrollArea className="h-[200px] mt-1">
                    <pre className="text-sm bg-muted p-3 rounded font-mono whitespace-pre-wrap">
                      {JSON.stringify(selectedMessage.payload, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
                {selectedMessage.errorMessage && (
                  <div>
                    <Label className="text-muted-foreground text-destructive">Error</Label>
                    <p className="mt-1 text-destructive text-sm">
                      {selectedMessage.errorMessage}
                    </p>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleCopyPayload(selectedMessage?.payload)}>
                <Copy className="w-4 h-4 mr-2" />
                Copy Payload
              </Button>
              <Button onClick={() => setIsDetailOpen(false)}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Replay Dialog */}
        <Dialog open={isReplayOpen} onOpenChange={setIsReplayOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Replay Message</DialogTitle>
              <DialogDescription>
                {t('mqtt.topicsMessages.replayMessage')}
              </DialogDescription>
            </DialogHeader>
            {replayMessage && (
              <div className="space-y-4">
                <div>
                  <Label>Topic</Label>
                  <Input value={replayMessage.topic} readOnly className="mt-1" />
                </div>
                <div>
                  <Label>Payload</Label>
                  <Textarea 
                    value={JSON.stringify(replayMessage.payload, null, 2)} 
                    readOnly 
                    className="mt-1 font-mono text-sm h-[150px]"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsReplayOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => {
                toast.info(t('mqtt.topicsMessages.replayInDev'));
                setIsReplayOpen(false);
              }}>
                <Send className="w-4 h-4 mr-2" />
                {t('mqtt.topicsMessages.resend')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
