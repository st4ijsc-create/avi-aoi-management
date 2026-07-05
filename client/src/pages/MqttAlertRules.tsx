import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, StatusBadge } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  AlertTriangle, Bell, Plus, Trash2, Edit, CheckCircle, XCircle,
  Clock, Activity, Wifi, WifiOff, RefreshCw, History, Settings, ArrowUpCircle
} from "lucide-react";
import { useTranslation } from 'react-i18next';
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";
// W8-C (doc 27 Đợt 6 leftover): escalation rules admin + activity (alertEscalationRouter).
import EscalationRulesSection from "@/components/EscalationRulesSection";

const RULE_TYPE_KEYS = [
  { value: 'LATENCY_THRESHOLD', labelKey: 'mqtt.alertRulesPage.types.latencyThreshold', unit: 'ms', descKey: 'mqtt.alertRulesPage.types.latencyThresholdDesc' },
  { value: 'BROKER_DISCONNECT', labelKey: 'mqtt.alertRulesPage.types.brokerDisconnect', unit: 'minutes', descKey: 'mqtt.alertRulesPage.types.brokerDisconnectDesc' },
  { value: 'MESSAGE_FAILURE_RATE', labelKey: 'mqtt.alertRulesPage.types.failureRate', unit: '%', descKey: 'mqtt.alertRulesPage.types.failureRateDesc' },
  { value: 'THROUGHPUT_LOW', labelKey: 'mqtt.alertRulesPage.types.throughputLow', unit: 'msg/min', descKey: 'mqtt.alertRulesPage.types.throughputLowDesc' },
  { value: 'THROUGHPUT_HIGH', labelKey: 'mqtt.alertRulesPage.types.throughputHigh', unit: 'msg/min', descKey: 'mqtt.alertRulesPage.types.throughputHighDesc' },
  { value: 'CLIENT_OFFLINE', labelKey: 'mqtt.alertRulesPage.types.clientOffline', unit: 'minutes', descKey: 'mqtt.alertRulesPage.types.clientOfflineDesc' },
];

const COMPARISON_OPERATORS = [
  { value: 'GT', label: '>' },
  { value: 'GTE', label: '>=' },
  { value: 'LT', label: '<' },
  { value: 'LTE', label: '<=' },
  { value: 'EQ', label: '=' },
];

export default function MqttAlertRules() {
  const { t } = useTranslation();
  const RULE_TYPES = RULE_TYPE_KEYS.map(rt => ({ ...rt, label: t(rt.labelKey), description: t(rt.descKey) }));
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    ruleType: 'LATENCY_THRESHOLD' as const,
    thresholdValue: 1000,
    thresholdUnit: 'ms',
    comparisonOperator: 'GT' as const,
    timeWindowMinutes: 5,
    notifyOwner: true,
    notifyEmail: false,
    notifyMqtt: false,
    cooldownMinutes: 15,
    categoryId: null as number | null,
  });

  const { data: rules, refetch: refetchRules } = trpc.mqttAlert.list.useQuery();
  const { data: history, refetch: refetchHistory } = trpc.mqttAlert.history.useQuery({ limit: 50 });
  const { data: unresolvedAlerts, refetch: refetchUnresolved } = trpc.mqttAlert.unresolved.useQuery();
  const { data: categories } = trpc.productCategory.list.useQuery({});

  const createMutation = trpc.mqttAlert.create.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.alertRulesPage.ruleCreated'));
      setIsCreateDialogOpen(false);
      resetForm();
      refetchRules();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = trpc.mqttAlert.update.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.alertRulesPage.ruleUpdated'));
      setEditingRule(null);
      resetForm();
      refetchRules();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = trpc.mqttAlert.delete.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.alertRulesPage.ruleDeleted'));
      refetchRules();
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleMutation = trpc.mqttAlert.toggle.useMutation({
    onSuccess: () => {
      refetchRules();
    },
    onError: (error) => toast.error(error.message),
  });

  const resolveMutation = trpc.mqttAlert.resolve.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.alertRulesPage.alertResolved'));
      refetchHistory();
      refetchUnresolved();
    },
    onError: (error) => toast.error(error.message),
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      ruleType: 'LATENCY_THRESHOLD',
      thresholdValue: 1000,
      thresholdUnit: 'ms',
      comparisonOperator: 'GT',
      timeWindowMinutes: 5,
      notifyOwner: true,
      notifyEmail: false,
      notifyMqtt: false,
      cooldownMinutes: 15,
      categoryId: null,
    });
  };

  const handleRuleTypeChange = (value: string) => {
    const ruleType = RULE_TYPES.find(r => r.value === value);
    setFormData(prev => ({
      ...prev,
      ruleType: value as any,
      thresholdUnit: ruleType?.unit || 'ms',
    }));
  };

  const handleSubmit = () => {
    if (editingRule) {
      updateMutation.mutate({
        id: editingRule.id,
        ...formData,
      });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (rule: any) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      description: rule.description || '',
      ruleType: rule.ruleType,
      thresholdValue: parseFloat(rule.thresholdValue),
      thresholdUnit: rule.thresholdUnit,
      comparisonOperator: rule.comparisonOperator,
      timeWindowMinutes: rule.timeWindowMinutes,
      notifyOwner: rule.notifyOwner,
      notifyEmail: rule.notifyEmail,
      notifyMqtt: rule.notifyMqtt,
      cooldownMinutes: rule.cooldownMinutes,
      categoryId: rule.categoryId || null,
    });
    setIsCreateDialogOpen(true);
  };

  const getCategoryName = (categoryId: number | null) => {
    if (!categoryId) return t('common.all');
    const cat = categories?.find(c => c.id === categoryId);
    return cat?.name || '-';
  };

  const getRuleTypeBadge = (type: string) => {
    // Map each rule type to a semantic tone (dark/light aware, token-driven).
    const tones: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
      'LATENCY_THRESHOLD': 'info',
      'BROKER_DISCONNECT': 'error',
      'MESSAGE_FAILURE_RATE': 'warning',
      'THROUGHPUT_LOW': 'warning',
      'THROUGHPUT_HIGH': 'info',
      'CLIENT_OFFLINE': 'default',
    };
    const labels: Record<string, string> = {
      'LATENCY_THRESHOLD': 'Latency',
      'BROKER_DISCONNECT': 'Disconnect',
      'MESSAGE_FAILURE_RATE': 'Failure Rate',
      'THROUGHPUT_LOW': 'Low Throughput',
      'THROUGHPUT_HIGH': 'High Throughput',
      'CLIENT_OFFLINE': 'Client Offline',
    };
    return <StatusBadge status={type} tone={tones[type] || 'default'} label={labels[type] || type} />;
  };

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<AlertTriangle className="h-5 w-5 text-warning" />}
          title="MQTT Alert Rules"
          description={t('mqtt.alertRulesPage.description')}
          badge={<ViewOnlyBadge module="mqtt_alerts" />}
          actions={
            <>
            <Button variant="outline" size="sm" onClick={() => { refetchRules(); refetchHistory(); refetchUnresolved(); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('common.refresh')}
            </Button>
            <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
              setIsCreateDialogOpen(open);
              if (!open) {
                setEditingRule(null);
                resetForm();
              }
            }}>
              <PermissionGate module="mqtt_alerts" action="canCreate">
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    {t('mqtt.alertRulesPage.createRule')}
                  </Button>
                </DialogTrigger>
              </PermissionGate>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{editingRule ? t('mqtt.alertRulesPage.editRule') : t('mqtt.alertRulesPage.createNewRule')}</DialogTitle>
                  <DialogDescription>
                    {t('mqtt.alertRulesPage.dialogDescription')}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t('mqtt.alertRulesPage.ruleName')}</Label>
                      <Input 
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="VD: Latency cao"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('mqtt.alertRulesPage.ruleType')}</Label>
                      <Select value={formData.ruleType} onValueChange={handleRuleTypeChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULE_TYPES.map(type => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('mqtt.alertRulesPage.descriptionLabel')}</Label>
                    <Textarea 
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder={t('mqtt.alertRulesPage.descriptionPlaceholder')}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>{t('mqtt.alertRulesPage.operator')}</Label>
                      <Select 
                        value={formData.comparisonOperator} 
                        onValueChange={(v) => setFormData(prev => ({ ...prev, comparisonOperator: v as any }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COMPARISON_OPERATORS.map(op => (
                            <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('mqtt.alertRulesPage.threshold')}</Label>
                      <Input 
                        type="number"
                        value={formData.thresholdValue}
                        onChange={(e) => setFormData(prev => ({ ...prev, thresholdValue: parseFloat(e.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('mqtt.alertRulesPage.unit')}</Label>
                      <Input 
                        value={formData.thresholdUnit}
                        onChange={(e) => setFormData(prev => ({ ...prev, thresholdUnit: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t('mqtt.alertRulesPage.evaluationPeriod')}</Label>
                      <Input 
                        type="number"
                        value={formData.timeWindowMinutes}
                        onChange={(e) => setFormData(prev => ({ ...prev, timeWindowMinutes: parseInt(e.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('mqtt.alertRulesPage.cooldownLabel')}</Label>
                      <Input 
                        type="number"
                        value={formData.cooldownMinutes}
                        onChange={(e) => setFormData(prev => ({ ...prev, cooldownMinutes: parseInt(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('mqtt.alertRulesPage.productCategory')}</Label>
                    <Select 
                      value={formData.categoryId?.toString() || 'all'} 
                      onValueChange={(v) => setFormData(prev => ({ ...prev, categoryId: v === 'all' ? null : parseInt(v) }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('mqtt.alertRulesPage.allCategories')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('mqtt.alertRulesPage.allCategories')}</SelectItem>
                        {categories?.map(cat => (
                          <SelectItem key={cat.id} value={cat.id.toString()}>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color || 'var(--primary)' }} />
                              {cat.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t('mqtt.alertRulesPage.categoryHint')}</p>
                  </div>
                  <div className="space-y-4 pt-4 border-t">
                    <Label className="text-base font-semibold">{t('mqtt.alertRulesPage.notifications')}</Label>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>{t('mqtt.alertRulesPage.notifyOwner')}</Label>
                        <p className="text-xs text-muted-foreground">{t('mqtt.alertRulesPage.sendViaManus')}</p>
                      </div>
                      <Switch 
                        checked={formData.notifyOwner}
                        onCheckedChange={(v) => setFormData(prev => ({ ...prev, notifyOwner: v }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>{t('mqtt.alertRulesPage.notifyEmail')}</Label>
                        <p className="text-xs text-muted-foreground">{t('mqtt.alertRulesPage.sendEmailAlert')}</p>
                      </div>
                      <Switch 
                        checked={formData.notifyEmail}
                        onCheckedChange={(v) => setFormData(prev => ({ ...prev, notifyEmail: v }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>{t('mqtt.alertRulesPage.notifyMqtt')}</Label>
                        <p className="text-xs text-muted-foreground">Publish alert qua MQTT topic</p>
                      </div>
                      <Switch 
                        checked={formData.notifyMqtt}
                        onCheckedChange={(v) => setFormData(prev => ({ ...prev, notifyMqtt: v }))}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t('common.cancel')}</Button>
                  <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                    {editingRule ? t('common.update') : t('mqtt.alertRulesPage.createRule')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </>
          }
        />

        {/* Unresolved Alerts Banner */}
        {unresolvedAlerts && unresolvedAlerts.length > 0 && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {unresolvedAlerts.length} {t('mqtt.alertRulesPage.unprocessedAlerts')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {unresolvedAlerts.slice(0, 3).map((alert: any) => (
                  <div key={alert.id} className="flex items-center justify-between bg-background/50 rounded-lg p-3">
                    <div>
                      <span className="font-medium">{alert.ruleName}</span>
                      <p className="text-sm text-muted-foreground">{alert.message}</p>
                    </div>
                    <PermissionGate module="mqtt_alerts" action="canEdit">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolveMutation.mutate({ id: alert.id })}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Resolve
                      </Button>
                    </PermissionGate>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="rules">
          <TabsList>
            <TabsTrigger value="rules" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Alert Rules
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="w-4 h-4" />
              {t('mqtt.alertRulesPage.history')}
            </TabsTrigger>
            <TabsTrigger value="escalation" className="flex items-center gap-2">
              <ArrowUpCircle className="w-4 h-4" />
              {t('escalation.tab', 'Escalation')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('mqtt.alertRulesPage.ruleList')}</CardTitle>
                <CardDescription>{t('mqtt.alertRulesPage.ruleListDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('mqtt.alertRulesPage.name')}</TableHead>
                      <TableHead>{t('mqtt.alertRulesPage.typeHeader')}</TableHead>
                      <TableHead>{t('mqtt.alertRulesPage.condition')}</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>{t('mqtt.alertRulesPage.notification')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead className="text-right">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules?.map((rule: any) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{rule.name}</span>
                            {rule.description && (
                              <p className="text-xs text-muted-foreground">{rule.description}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getRuleTypeBadge(rule.ruleType)}</TableCell>
                        <TableCell>
                          <code className="text-sm bg-muted px-2 py-1 rounded">
                            {COMPARISON_OPERATORS.find(o => o.value === rule.comparisonOperator)?.label} {rule.thresholdValue} {rule.thresholdUnit}
                          </code>
                        </TableCell>
                        <TableCell>
                          {rule.categoryId ? (
                            <Badge variant="outline" className="text-xs">
                              {getCategoryName(rule.categoryId)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">{t('common.all')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {rule.notifyOwner && <Badge variant="outline" className="text-xs">Owner</Badge>}
                            {rule.notifyEmail && <Badge variant="outline" className="text-xs">Email</Badge>}
                            {rule.notifyMqtt && <Badge variant="outline" className="text-xs">MQTT</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <PermissionGate module="mqtt_alerts" action="canEdit">
                            <Switch
                              checked={rule.isEnabled}
                              onCheckedChange={(v) => toggleMutation.mutate({ id: rule.id, isEnabled: v })}
                            />
                          </PermissionGate>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <PermissionGate module="mqtt_alerts" action="canEdit">
                              <Button size="sm" variant="ghost" onClick={() => handleEdit(rule)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                            </PermissionGate>
                            <PermissionGate module="mqtt_alerts" action="canDelete">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive/80"
                                onClick={() => deleteMutation.mutate({ id: rule.id })}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </PermissionGate>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!rules || rules.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          {t('mqtt.alertRulesPage.noRulesHint')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('mqtt.alertRulesPage.alertHistory')}</CardTitle>
                <CardDescription>{t('mqtt.alertRulesPage.alertHistoryDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('mqtt.alertRulesPage.timeHeader')}</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead>{t('mqtt.alertRulesPage.value')}</TableHead>
                      <TableHead>{t('mqtt.alertRulesPage.content')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead className="text-right">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history?.map((alert: any) => (
                      <TableRow key={alert.id}>
                        <TableCell className="text-sm">
                          {new Date(alert.triggeredAt).toLocaleString('vi-VN')}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{alert.ruleName}</span>
                        </TableCell>
                        <TableCell>
                          <code className="text-sm bg-muted px-2 py-1 rounded">
                            {alert.triggeredValue} ({t('mqtt.alertRulesPage.threshold')}: {alert.thresholdValue})
                          </code>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{alert.message}</TableCell>
                        <TableCell>
                          {alert.isResolved ? (
                            <StatusBadge
                              status="resolved"
                              tone="success"
                              label={<span className="flex items-center"><CheckCircle className="w-3 h-3 mr-1" />{t('mqtt.alertRulesPage.resolved')}</span>}
                            />
                          ) : (
                            <StatusBadge
                              status="unresolved"
                              tone="error"
                              label={<span className="flex items-center"><XCircle className="w-3 h-3 mr-1" />{t('mqtt.alertRulesPage.unresolved')}</span>}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!alert.isResolved && (
                            <PermissionGate module="mqtt_alerts" action="canEdit">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => resolveMutation.mutate({ id: alert.id })}
                              >
                                Resolve
                              </Button>
                            </PermissionGate>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!history || history.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          {t('mqtt.alertRulesPage.noAlerts')}.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* W8-C (doc 27 Đợt 6 leftover): escalation rules CRUD + escalated-alert ledger. */}
          <TabsContent value="escalation">
            <EscalationRulesSection />
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}
