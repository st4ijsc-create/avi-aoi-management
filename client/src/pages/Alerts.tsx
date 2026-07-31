import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';
import { PageHeader, PageContainer } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { 
  Bell, 
  Plus, 
  Settings, 
  Trash2, 
  History, 
  AlertTriangle,
  CheckCircle2,
  Mail,
  MessageSquare,
  Smartphone,
  Edit,
  Play,
  Loader2,
  TrendingDown,
  Hash,
  Cpu
} from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { navItems } from "@/lib/navigation";
import { useState } from "react";
import { useCanWrite, ViewOnlyBadge } from "@/components/PermissionGate";

const ALERT_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  yield_rate: { 
    label: "Yield Rate", 
    icon: <TrendingDown className="h-4 w-4" />,
    description: "alerts.yieldRateDesc"
  },
  ng_count: { 
    label: "alerts.ngCountLabel", 
    icon: <Hash className="h-4 w-4" />,
    description: "alerts.ngCountDesc"
  },
  machine_status: { 
    label: "alerts.machineStatusLabel", 
    icon: <Cpu className="h-4 w-4" />,
    description: "alerts.machineStatusDesc"
  },
};

const COMPARISON_LABELS: Record<string, string> = {
  lt: "alerts.lessThan",
  lte: "alerts.lessThanOrEqual",
  gt: "alerts.greaterThan",
  gte: "alerts.greaterThanOrEqual",
  eq: "alerts.equal",
};

export default function Alerts() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("settings");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<any>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    alertType: "yield_rate" as "yield_rate" | "ng_count" | "machine_status",
    threshold: 90,
    comparisonOperator: "lt" as "lt" | "lte" | "gt" | "gte" | "eq",
    notifyEmail: true,
    notifySms: false,
    notifyInApp: true,
    cooldownMinutes: 60,
  });

  // W3-batch2 (doc 35 F3): gate write actions for read-only roles (route module = mqtt_alerts).
  const { canCreate, canEdit, canDelete } = useCanWrite("mqtt_alerts");
  const readOnlyTitle = t("common.viewOnlyHint", "Bạn chỉ có quyền xem");

  const utils = trpc.useUtils();
  const { data: alerts, isLoading } = trpc.alert.list.useQuery();
  const { data: alertHistory } = trpc.alert.history.useQuery({ limit: 50 });
  const { data: machines } = trpc.machine.list.useQuery();

  const createMutation = trpc.alert.create.useMutation({
    onSuccess: () => {
      toast.success(t('alerts.createSuccess'));
      utils.alert.list.invalidate();
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  const updateMutation = trpc.alert.update.useMutation({
    onSuccess: () => {
      toast.success(t('alerts.updateSuccess'));
      utils.alert.list.invalidate();
      setEditingAlert(null);
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  const deleteMutation = trpc.alert.delete.useMutation({
    onSuccess: () => {
      toast.success(t('alerts.deleteSuccess'));
      utils.alert.list.invalidate();
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  const testMutation = trpc.alert.test.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(t('alerts.testSent'));
        utils.alert.history.invalidate();
      } else {
        toast.error(t('alerts.testFailed'));
      }
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  const acknowledgeMutation = trpc.alert.acknowledge.useMutation({
    onSuccess: () => {
      toast.success(t('alerts.acknowledged'));
      utils.alert.history.invalidate();
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      alertType: "yield_rate",
      threshold: 90,
      comparisonOperator: "lt",
      notifyEmail: true,
      notifySms: false,
      notifyInApp: true,
      cooldownMinutes: 60,
    });
  };

  const handleCreate = () => {
    createMutation.mutate(formData);
  };

  const handleToggleActive = (alert: any) => {
    updateMutation.mutate({
      id: alert.id,
      isActive: !alert.isActive,
    });
  };

  return (
    <DashboardLayout navItems={navItems} currentPath="/alerts">
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<Bell className="h-5 w-5 text-primary" />}
          title={t('alerts.title')}
          description={t('alerts.subtitle')}
          badge={<ViewOnlyBadge module="mqtt_alerts" />}
          actions={
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" disabled={!canCreate} title={!canCreate ? readOnlyTitle : undefined}>
                  <Plus className="h-4 w-4" />
                  {t('alerts.createNew')}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t('alerts.createNew')}</DialogTitle>
                <DialogDescription>
                  {t('alerts.createDesc')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>{t('alerts.alertName')}</Label>
                  <Input
                    placeholder={t('alerts.alertNamePlaceholder')}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('alerts.alertType')}</Label>
                  <Select
                    value={formData.alertType}
                    onValueChange={(v: any) => setFormData({ ...formData, alertType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ALERT_TYPE_LABELS).map(([key, { label, icon }]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            {icon}
                            {label.startsWith('alerts.') ? t(label) : label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('alerts.condition')}</Label>
                    <Select
                      value={formData.comparisonOperator}
                      onValueChange={(v: any) => setFormData({ ...formData, comparisonOperator: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(COMPARISON_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{t(label)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('alerts.threshold')} {formData.alertType === "yield_rate" ? "(%)" : ""}</Label>
                    <Input
                      type="number"
                      value={formData.threshold}
                      onChange={(e) => setFormData({ ...formData, threshold: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t('alerts.cooldown')}</Label>
                  <Input
                    type="number"
                    min={5}
                    max={1440}
                    value={formData.cooldownMinutes}
                    onChange={(e) => setFormData({ ...formData, cooldownMinutes: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-3">
                  <Label>{t('alerts.notifyMethod')}</Label>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-primary" />
                        <span>Email</span>
                      </div>
                      <Switch
                        checked={formData.notifyEmail}
                        onCheckedChange={(v) => setFormData({ ...formData, notifyEmail: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-primary" />
                        <span>{t('alerts.inAppNotify')}</span>
                      </div>
                      <Switch
                        checked={formData.notifyInApp}
                        onCheckedChange={(v) => setFormData({ ...formData, notifyInApp: v })}
                      />
                    </div>
                    {/* MON-F10 — SMS là no-op (dispatchAlert không có nhánh SMS). Tắt hẳn
                        switch + tooltip 'sắp có' để không hứa hẹn thông báo sẽ gửi. */}
                    <div
                      className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 opacity-50"
                      title={t('alerts.smsComingTooltip', 'SMS chưa được hỗ trợ — sắp có')}
                    >
                      <div className="flex items-center gap-2">
                        <Smartphone className="h-4 w-4 text-muted-foreground" />
                        <span>{t('alerts.smsComing')}</span>
                      </div>
                      <Switch disabled checked={false} title={t('alerts.smsComingTooltip', 'SMS chưa được hỗ trợ — sắp có')} />
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button 
                  onClick={handleCreate}
                  disabled={!formData.name || createMutation.isPending}
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t('alerts.createAlert')}
                </Button>
              </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4" />
              {t('alerts.tabSettings')}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              {t('alerts.tabHistory')}
            </TabsTrigger>
          </TabsList>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            {isLoading ? (
              <div className="grid gap-4">
                {[0, 1, 2].map((i) => (
                  <Card key={i} className="glass-card">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-4">
                        <Skeleton className="h-11 w-11 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-5 w-40" />
                          <Skeleton className="h-4 w-56" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : alerts && alerts.length > 0 ? (
              <div className="grid gap-4">
                {alerts.map((alert) => (
                  <Card key={alert.id} className={`glass-card ${!alert.isActive ? 'opacity-60' : ''}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-4">
                          <div className={`p-3 rounded-lg ${alert.isActive ? 'bg-primary/20' : 'bg-muted'}`}>
                            {ALERT_TYPE_LABELS[alert.alertType]?.icon || <Bell className="h-5 w-5" />}
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground flex items-center gap-2">
                              {alert.name}
                              {!alert.isActive && (
                                <Badge variant="secondary">{t('alerts.paused')}</Badge>
                              )}
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              {ALERT_TYPE_LABELS[alert.alertType]?.label && ALERT_TYPE_LABELS[alert.alertType].label.startsWith('alerts.') ? t(ALERT_TYPE_LABELS[alert.alertType].label) : ALERT_TYPE_LABELS[alert.alertType]?.label} {t(COMPARISON_LABELS[alert.comparisonOperator])} {alert.threshold}
                              {alert.alertType === 'yield_rate' ? '%' : ''}
                            </p>
                            <div className="flex items-center gap-3 mt-2">
                              {alert.notifyEmail && (
                                <Badge variant="outline" className="gap-1">
                                  <Mail className="h-3 w-3" />
                                  Email
                                </Badge>
                              )}
                              {alert.notifyInApp && (
                                <Badge variant="outline" className="gap-1">
                                  <Bell className="h-3 w-3" />
                                  In-app
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                Cooldown: {alert.cooldownMinutes} {t('alerts.minutes')}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={alert.isActive}
                            onCheckedChange={() => handleToggleActive(alert)}
                            disabled={!canEdit}
                            title={!canEdit ? readOnlyTitle : undefined}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => testMutation.mutate({ id: alert.id })}
                            disabled={!canEdit || testMutation.isPending}
                            title={!canEdit ? readOnlyTitle : undefined}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteMutation.mutate({ id: alert.id })}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="glass-card">
                <CardContent className="py-12 text-center">
                  <Bell className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">{t('alerts.noAlerts')}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('alerts.noAlertsDesc')}
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            {alertHistory && alertHistory.length > 0 ? (
              <div className="space-y-3">
                {alertHistory.map((item) => (
                  <Card key={item.id} className="glass-card">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${item.acknowledgedAt ? 'bg-success/20' : 'bg-warning/20'}`}>
                            {item.acknowledgedAt ? (
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-warning" />
                            )}
                          </div>
                          <div>
                            <p className="text-foreground">{item.message}</p>
                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                              <span>{t('alerts.triggeredValue')}: {item.triggeredValue}</span>
                              <span>•</span>
                              <span>{new Date(item.createdAt).toLocaleString('vi-VN')}</span>
                            </div>
                          </div>
                        </div>
                        {!item.acknowledgedAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => acknowledgeMutation.mutate({ id: item.id })}
                            disabled={!canEdit}
                            title={!canEdit ? readOnlyTitle : undefined}
                          >
                            {t('alerts.acknowledge')}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="glass-card">
                <CardContent className="py-12 text-center">
                  <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">{t('alerts.noHistory')}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}
