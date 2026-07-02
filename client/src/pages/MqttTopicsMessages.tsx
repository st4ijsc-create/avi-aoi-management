import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, MetricCard } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

export function MqttTopicsMessagesContent() {
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
        return <CheckCircle className="w-4 h-4 text-success" />;
      case "FAILED":
        return <XCircle className="w-4 h-4 text-destructive" />;
      case "PENDING":
        return <Clock className="w-4 h-4 text-warning" />;
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
    <>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<MessageSquare className="w-6 h-6" />}
          title={t('mqtt.topicsMessages.title', 'MQTT Topics & Messages')}
          description={t('mqtt.topicsMessages.pageDesc')}
          actions={
            <>
              <Button variant="outline" onClick={() => refetchMessages()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t('common.refresh')}
              </Button>
              <Button variant="outline" onClick={handleExportMessages}>
                <Download className="w-4 h-4 mr-2" />
                {t('mqtt.topicsMessages.exportJson')}
              </Button>
            </>
          }
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard
            icon={<Radio className="w-4 h-4" />}
            label={t('mqtt.topicsMessages.totalTopics')}
            value={topicStats.length}
          />
          <MetricCard
            icon={<MessageSquare className="w-4 h-4" />}
            label={t('mqtt.topicsMessages.totalMessages')}
            value={messageLogs.length}
          />
          <MetricCard
            icon={<CheckCircle className="w-4 h-4" />}
            label={t('mqtt.topicsMessages.delivered', 'Delivered')}
            value={messageLogs.filter((m: any) => m.deliveryStatus === "DELIVERED").length}
            tone="success"
          />
          <MetricCard
            icon={<XCircle className="w-4 h-4" />}
            label={t('mqtt.topicsMessages.failed', 'Failed')}
            value={messageLogs.filter((m: any) => m.deliveryStatus === "FAILED").length}
            tone="error"
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="topics">
              <Radio className="w-4 h-4 mr-2" />
              {t('mqtt.topicsMessages.topicsTab', 'Topics')}
            </TabsTrigger>
            <TabsTrigger value="messages">
              <MessageSquare className="w-4 h-4 mr-2" />
              {t('mqtt.topicsMessages.messagesTab', 'Messages')}
            </TabsTrigger>
            <TabsTrigger value="recent">
              <Inbox className="w-4 h-4 mr-2" />
              {t('mqtt.topicsMessages.recentActivityTab', 'Recent Activity')}
            </TabsTrigger>
          </TabsList>

          {/* Topics Tab */}
          <TabsContent value="topics" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('mqtt.topicsMessages.topicStatistics', 'Topic Statistics')}</CardTitle>
                <CardDescription>
                  {t('mqtt.topicsMessages.topicStats')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('mqtt.topicsMessages.colTopic', 'Topic')}</TableHead>
                      <TableHead>{t('mqtt.topicsMessages.colMessageCount', 'Message Count')}</TableHead>
                      <TableHead>{t('mqtt.topicsMessages.colTypes', 'Types')}</TableHead>
                      <TableHead>{t('mqtt.topicsMessages.colLastMessage', 'Last Message')}</TableHead>
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
                      <SelectValue placeholder={t('mqtt.topicsMessages.messageTypePlaceholder', 'Message Type')} />
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
                      <SelectValue placeholder={t('common.status', 'Status')} />
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
                      <TableHead>{t('common.status', 'Status')}</TableHead>
                      <TableHead>{t('mqtt.topicsMessages.colType', 'Type')}</TableHead>
                      <TableHead>{t('mqtt.topicsMessages.colTopic', 'Topic')}</TableHead>
                      <TableHead>{t('mqtt.topicsMessages.colTime', 'Time')}</TableHead>
                      <TableHead className="text-right">{t('common.actions', 'Actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingMessages ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={5}>
                            <Skeleton className="h-6 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
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
                <CardTitle>{t('mqtt.topicsMessages.recentMessagesTitle', 'Recent Messages')}</CardTitle>
                <CardDescription>
                  {t('mqtt.topicsMessages.recentMessages')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {loadingRecent ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full rounded-lg" />
                      ))
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
              <DialogTitle>{t('mqtt.topicsMessages.messageDetailTitle', 'Message Detail')}</DialogTitle>
              <DialogDescription>
                {t('mqtt.topicsMessages.messageDetail')}
              </DialogDescription>
            </DialogHeader>
            {selectedMessage && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">{t('mqtt.topicsMessages.colType', 'Type')}</Label>
                    <div className="mt-1">
                      <Badge variant={getMessageTypeColor(selectedMessage.messageType) as any}>
                        {selectedMessage.messageType}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">{t('common.status', 'Status')}</Label>
                    <div className="mt-1 flex items-center gap-2">
                      {getStatusIcon(selectedMessage.deliveryStatus)}
                      <span>{selectedMessage.deliveryStatus}</span>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-muted-foreground">{t('mqtt.topicsMessages.colTopic', 'Topic')}</Label>
                    <p className="mt-1 font-mono text-sm bg-muted p-2 rounded">
                      {selectedMessage.topic}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">{t('mqtt.topicsMessages.createdAt', 'Created At')}</Label>
                    <p className="mt-1">{formatDate(selectedMessage.createdAt)}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">{t('mqtt.topicsMessages.deliveredAt', 'Delivered At')}</Label>
                    <p className="mt-1">{formatDate(selectedMessage.deliveredAt)}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('mqtt.topicsMessages.payloadLabel', 'Payload')}</Label>
                  <ScrollArea className="h-[200px] mt-1">
                    <pre className="text-sm bg-muted p-3 rounded font-mono whitespace-pre-wrap">
                      {JSON.stringify(selectedMessage.payload, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
                {selectedMessage.errorMessage && (
                  <div>
                    <Label className="text-muted-foreground text-destructive">{t('mqtt.topicsMessages.errorLabel', 'Error')}</Label>
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
                {t('mqtt.topicsMessages.copyPayload', 'Copy Payload')}
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
              <DialogTitle>{t('mqtt.topicsMessages.replayMessageTitle', 'Replay Message')}</DialogTitle>
              <DialogDescription>
                {t('mqtt.topicsMessages.replayMessage')}
              </DialogDescription>
            </DialogHeader>
            {replayMessage && (
              <div className="space-y-4">
                <div>
                  <Label>{t('mqtt.topicsMessages.colTopic', 'Topic')}</Label>
                  <Input value={replayMessage.topic} readOnly className="mt-1" />
                </div>
                <div>
                  <Label>{t('mqtt.topicsMessages.payloadLabel', 'Payload')}</Label>
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
      </PageContainer>
    </>
  );
}

export default function MqttTopicsMessages() {
  return (
    <DashboardLayout>
      <MqttTopicsMessagesContent />
    </DashboardLayout>
  );
}
