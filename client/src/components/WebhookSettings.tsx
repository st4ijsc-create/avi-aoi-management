import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Link2,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Send,
  Eye,
  Pencil,
  MoreHorizontal,
  Activity,
  Globe,
  Clock,
  Hash,
  AlertTriangle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WebhookFormData {
  name: string;
  description: string;
  url: string;
  secret: string;
  events: string[];
  headers: Record<string, string>;
  retryCount: number;
  retryDelayMs: number;
  timeoutMs: number;
}

const EMPTY_FORM: WebhookFormData = {
  name: "",
  description: "",
  url: "",
  secret: "",
  events: [],
  headers: {},
  retryCount: 3,
  retryDelayMs: 1000,
  timeoutMs: 10000,
};

export default function WebhookSettings() {
  const { t } = useTranslation();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form, setForm] = useState<WebhookFormData>(EMPTY_FORM);
  const [headerKey, setHeaderKey] = useState("");
  const [headerValue, setHeaderValue] = useState("");

  // Queries
  const { data: webhooks, refetch: refetchWebhooks, isLoading } = trpc.webhook.list.useQuery();
  const { data: stats } = trpc.webhook.getStats.useQuery();
  const { data: events } = trpc.webhook.listEvents.useQuery();
  const { data: detail } = trpc.webhook.getById.useQuery(
    { id: detailId! },
    { enabled: detailId !== null }
  );
  const { data: deliveryLogs, refetch: refetchLogs } = trpc.webhook.getDeliveryLogs.useQuery({
    limit: 50,
  });

  // Mutations
  const createMutation = trpc.webhook.create.useMutation({
    onSuccess: () => {
      toast.success(t("webhook.createSuccess"));
      closeDialog();
      refetchWebhooks();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.webhook.update.useMutation({
    onSuccess: () => {
      toast.success(t("webhook.updateSuccess"));
      closeDialog();
      refetchWebhooks();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.webhook.delete.useMutation({
    onSuccess: () => {
      toast.success(t("webhook.deleteSuccess"));
      refetchWebhooks();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = trpc.webhook.toggle.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchWebhooks();
    },
    onError: (err) => toast.error(err.message),
  });

  const testMutation = trpc.webhook.test.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
      refetchLogs();
    },
    onError: (err) => toast.error(err.message),
  });

  const clearLogsMutation = trpc.webhook.clearLogs.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchLogs();
    },
    onError: (err) => toast.error(err.message),
  });

  const closeDialog = () => {
    setCreateDialogOpen(false);
    setEditId(null);
    setForm(EMPTY_FORM);
    setHeaderKey("");
    setHeaderValue("");
  };

  const openEdit = (webhook: any) => {
    setEditId(webhook.id);
    setForm({
      name: webhook.name,
      description: webhook.description || "",
      url: webhook.url,
      secret: webhook.secret || "",
      events: webhook.events || [],
      headers: webhook.headers || {},
      retryCount: webhook.retryCount || 3,
      retryDelayMs: webhook.retryDelayMs || 1000,
      timeoutMs: webhook.timeoutMs || 10000,
    });
    setCreateDialogOpen(true);
  };

  const addHeader = () => {
    if (headerKey.trim()) {
      setForm(prev => ({
        ...prev,
        headers: { ...prev.headers, [headerKey.trim()]: headerValue.trim() },
      }));
      setHeaderKey("");
      setHeaderValue("");
    }
  };

  const removeHeader = (key: string) => {
    setForm(prev => {
      const next = { ...prev.headers };
      delete next[key];
      return { ...prev, headers: next };
    });
  };

  const toggleEvent = (event: string) => {
    setForm(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event],
    }));
  };

  const handleSubmit = () => {
    if (editId) {
      updateMutation.mutate({ id: editId, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Link2 className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.totalWebhooks || 0}</p>
                <p className="text-sm text-muted-foreground">{t("webhook.totalWebhooks")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Zap className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.activeWebhooks || 0}</p>
                <p className="text-sm text-muted-foreground">{t("webhook.activeWebhooks")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Send className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.totalDeliveries || 0}</p>
                <p className="text-sm text-muted-foreground">{t("webhook.totalDeliveries")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.successRate ? `${stats.successRate.toFixed(1)}%` : "—"}</p>
                <p className="text-sm text-muted-foreground">{t("webhook.successRate")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={() => { setForm(EMPTY_FORM); setCreateDialogOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("webhook.addWebhook")}
        </Button>
        <Button variant="outline" onClick={() => refetchWebhooks()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t("common.refresh")}
        </Button>
      </div>

      <Tabs defaultValue="webhooks" className="space-y-4">
        <TabsList>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="delivery-logs">{t("webhook.deliveryLogs")}</TabsTrigger>
        </TabsList>

        {/* Webhooks List */}
        <TabsContent value="webhooks">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                {t("webhook.title")}
              </CardTitle>
              <CardDescription>{t("webhook.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !webhooks || webhooks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-3">
                  <Link2 className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">{t("webhook.noWebhooks")}</p>
                  <Button onClick={() => { setForm(EMPTY_FORM); setCreateDialogOpen(true); }} size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    {t("webhook.addWebhook")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {webhooks.map((webhook) => (
                    <div
                      key={webhook.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <Switch
                          checked={webhook.isEnabled}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: webhook.id, isEnabled: checked })}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{webhook.name}</p>
                            <Badge variant={webhook.isEnabled ? "default" : "secondary"}>
                              {webhook.isEnabled ? t("webhook.active") : t("webhook.inactive")}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            <Globe className="inline h-3 w-3 mr-1" />
                            {webhook.url}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex gap-1 flex-wrap">
                              {(webhook.events as string[])?.slice(0, 3).map(e => (
                                <Badge key={e} variant="outline" className="text-xs">{e}</Badge>
                              ))}
                              {(webhook.events as string[])?.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{(webhook.events as string[]).length - 3}
                                </Badge>
                              )}
                            </div>
                            {webhook.successCount !== undefined && (
                              <span className="text-xs text-muted-foreground">
                                <CheckCircle2 className="inline h-3 w-3 text-green-500 mr-1" />
                                {webhook.successCount}
                                <XCircle className="inline h-3 w-3 text-red-500 ml-2 mr-1" />
                                {webhook.failureCount || 0}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailId(webhook.id)}>
                            <Eye className="h-4 w-4 mr-2" />
                            {t('webhook.details')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(webhook)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            {t('common.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => testMutation.mutate({ id: webhook.id })}>
                            <Send className="h-4 w-4 mr-2" />
                            {t("webhook.testWebhook")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteMutation.mutate({ id: webhook.id })}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t('common.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Delivery Logs */}
        <TabsContent value="delivery-logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    {t("webhook.deliveryLogs")}
                  </CardTitle>
                  <CardDescription>{t('webhook.recentDeliveryHistory')}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetchLogs()} className="gap-1">
                    <RefreshCw className="h-3 w-3" />
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clearLogsMutation.mutate({ olderThanDays: 30 })}
                    className="gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('webhook.clearOldLogs')}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!deliveryLogs || deliveryLogs.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-muted-foreground">
                  <Activity className="h-12 w-12 mb-3" />
                  <p>{t('webhook.noLogs')}</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {deliveryLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between p-3 border rounded-lg text-sm"
                      >
                        <div className="flex items-center gap-3">
                          {log.success ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">{log.eventType}</Badge>
                              {log.responseStatus && (
                                <Badge variant={log.success ? "default" : "destructive"} className="text-xs">
                                  HTTP {log.responseStatus}
                                </Badge>
                              )}
                              {log.attempt && log.attempt > 1 && (
                                <Badge variant="secondary" className="text-xs">
                                  Attempt #{log.attempt}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-muted-foreground text-xs">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(log.createdAt).toLocaleString()}
                              </span>
                              {log.responseTimeMs && (
                                <span>{log.responseTimeMs}ms</span>
                              )}
                              {!log.success && log.errorMessage && (
                                <span className="text-red-500 truncate max-w-[200px]">
                                  {log.errorMessage}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create / Edit Webhook Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              {editId ? t("webhook.editWebhook") : t("webhook.addWebhook")}
            </DialogTitle>
            <DialogDescription>{t("webhook.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("webhook.webhookName")} *</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="VD: ERP Integration"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("webhook.secret")}</label>
                <Input
                  value={form.secret}
                  onChange={(e) => setForm(prev => ({ ...prev, secret: e.target.value }))}
                  placeholder={t('webhook.hmacSecretPlaceholder')}
                  type="password"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("webhook.url")} *</label>
              <Input
                value={form.url}
                onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                placeholder="https://your-erp-system.com/webhook"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('common.description')}</label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('webhook.descriptionPlaceholder')}
                rows={2}
              />
            </div>

            {/* Events */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("webhook.events")} *</label>
              <div className="grid grid-cols-2 gap-2">
                {events?.map((event) => (
                  <label
                    key={event.value}
                    className={`flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-accent transition-colors ${
                      form.events.includes(event.value) ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.events.includes(event.value)}
                      onChange={() => toggleEvent(event.value)}
                      className="rounded"
                    />
                    <div>
                      <span className="text-sm font-medium">{event.label}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Headers */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("webhook.headers")}</label>
              <div className="space-y-2">
                {Object.entries(form.headers).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{key}</Badge>
                    <span className="text-muted-foreground truncate">{value}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeHeader(key)}>
                      <XCircle className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={headerKey}
                  onChange={(e) => setHeaderKey(e.target.value)}
                  placeholder="Key"
                  className="flex-1"
                />
                <Input
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  placeholder="Value"
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={addHeader} disabled={!headerKey.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Advanced */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("webhook.retryCount")}</label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={form.retryCount}
                  onChange={(e) => setForm(prev => ({ ...prev, retryCount: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Retry Delay (ms)</label>
                <Input
                  type="number"
                  min={100}
                  max={60000}
                  value={form.retryDelayMs}
                  onChange={(e) => setForm(prev => ({ ...prev, retryDelayMs: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("webhook.timeout")}</label>
                <Input
                  type="number"
                  min={1000}
                  max={60000}
                  value={form.timeoutMs}
                  onChange={(e) => setForm(prev => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.name || !form.url || form.events.length === 0 || createMutation.isPending || updateMutation.isPending}
              className="gap-2"
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {editId ? t("common.save") : t("webhook.addWebhook")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailId !== null} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {t('webhook.webhookDetails')}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">{t('webhook.name')}</label>
                  <p className="font-medium">{detail.name}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{t('common.status')}</label>
                  <div>
                    <Badge variant={detail.isEnabled ? "default" : "secondary"}>
                      {detail.isEnabled ? t("webhook.active") : t("webhook.inactive")}
                    </Badge>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">URL</label>
                <p className="text-sm font-mono break-all">{detail.url}</p>
              </div>
              {detail.description && (
                <div>
                  <label className="text-sm text-muted-foreground">{t('common.description')}</label>
                  <p className="text-sm">{detail.description}</p>
                </div>
              )}
              <div>
                <label className="text-sm text-muted-foreground">Events</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(detail.events as string[])?.map(e => (
                    <Badge key={e} variant="outline">{e}</Badge>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <label className="text-muted-foreground">Success</label>
                  <p className="text-green-600 font-medium">{detail.successCount || 0}</p>
                </div>
                <div>
                  <label className="text-muted-foreground">Failure</label>
                  <p className="text-red-600 font-medium">{detail.failureCount || 0}</p>
                </div>
                <div>
                  <label className="text-muted-foreground">Last triggered</label>
                  <p>{detail.lastTriggeredAt ? new Date(detail.lastTriggeredAt).toLocaleString() : "—"}</p>
                </div>
              </div>
              {detail.deliveryLogs && (detail.deliveryLogs as any[]).length > 0 && (
                <div>
                  <label className="text-sm text-muted-foreground">Recent Delivery Logs</label>
                  <ScrollArea className="h-[200px] mt-2">
                    <div className="space-y-2">
                      {(detail.deliveryLogs as any[]).map((log: any) => (
                        <div key={log.id} className="flex items-center gap-2 p-2 border rounded text-xs">
                          {log.success ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500" />
                          )}
                          <Badge variant="outline">{log.eventType}</Badge>
                          <span>HTTP {log.responseStatus || "—"}</span>
                          <span>{log.responseTimeMs}ms</span>
                          <span className="text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
