import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge, PermissionGate } from "@/components/PermissionGate";
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Plus,
  Edit,
  Trash2,
  Check,
  AlertTriangle,
  Activity,
  Settings,
  Eye,
  Pause,
  StopCircle,
  Bell,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

// ── Constants ──

const GATE_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  yield_rate: { label: "qualityGates.yieldRate", icon: <Activity className="h-4 w-4" /> },
  ng_count: { label: "qualityGates.ngCount", icon: <ShieldAlert className="h-4 w-4" /> },
  ng_rate: { label: "qualityGates.ngRate", icon: <ShieldX className="h-4 w-4" /> },
  cpk_threshold: { label: "qualityGates.cpkThreshold", icon: <Settings className="h-4 w-4" /> },
  consecutive_ng: { label: "qualityGates.consecutiveNg", icon: <AlertTriangle className="h-4 w-4" /> },
};

const COMPARISON_LABELS: Record<string, string> = {
  lt: "qualityGates.compLessThan",
  lte: "qualityGates.compLessThanOrEqual",
  gt: "qualityGates.compGreaterThan",
  gte: "qualityGates.compGreaterThanOrEqual",
  eq: "qualityGates.compEqual",
};

const COMPARISON_SYMBOLS: Record<string, string> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  eq: "=",
};

const ACTION_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  alert: { label: "qualityGates.actionAlert", icon: <Bell className="h-4 w-4" />, color: "bg-yellow-500" },
  pause: { label: "qualityGates.actionPause", icon: <Pause className="h-4 w-4" />, color: "bg-orange-500" },
  stop: { label: "qualityGates.actionStop", icon: <StopCircle className="h-4 w-4" />, color: "bg-red-500" },
};

const EVENT_STATUS_VARIANT: Record<string, "destructive" | "secondary" | "default" | "outline"> = {
  active: "destructive",
  acknowledged: "secondary",
  resolved: "default",
  auto_resolved: "outline",
};

const EVENT_STATUS_CLASS: Record<string, string> = {
  active: "bg-red-500 text-white",
  acknowledged: "bg-yellow-500 text-white",
  resolved: "bg-green-500 text-white",
  auto_resolved: "bg-blue-500 text-white",
};

// ── Types ──

interface GateFormData {
  name: string;
  description: string;
  gateType: string;
  threshold: number;
  comparisonOperator: string;
  action: string;
  windowSize: number;
  consecutiveCount: number;
  autoResumeAfterMinutes: number | null;
  isActive: boolean;
  lineId: number | null;
  workstationId: number | null;
  productModelId: number | null;
  machineId: number | null;
}

const defaultFormData: GateFormData = {
  name: "",
  description: "",
  gateType: "yield_rate",
  threshold: 95,
  comparisonOperator: "lt",
  action: "alert",
  windowSize: 100,
  consecutiveCount: 3,
  autoResumeAfterMinutes: null,
  isActive: true,
  lineId: null,
  workstationId: null,
  productModelId: null,
  machineId: null,
};

// ── Main Component ──

export function QualityGatesContent() {
  const [activeTab, setActiveTab] = useState("gates");

  // Gate management state
  const [gateDialogOpen, setGateDialogOpen] = useState(false);
  const [editingGateId, setEditingGateId] = useState<number | null>(null);
  const [formData, setFormData] = useState<GateFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Event action state
  const [eventActionDialog, setEventActionDialog] = useState<{
    open: boolean;
    type: "acknowledge" | "resolve";
    eventId: number | null;
  }>({ open: false, type: "acknowledge", eventId: null });
  const [eventNotes, setEventNotes] = useState("");

  // Event filters
  const [eventGateFilter, setEventGateFilter] = useState<string>("all");
  const [eventStatusFilter, setEventStatusFilter] = useState<string>("all");

  const { t } = useTranslation();

  // ── Queries ──

  const gatesQuery = trpc.qualityGate.list.useQuery({});
  const activeEventsQuery = trpc.qualityGate.activeEvents.useQuery();
  const eventsQuery = trpc.qualityGate.events.useQuery({
    qualityGateId: eventGateFilter !== "all" ? Number(eventGateFilter) : undefined,
    status: eventStatusFilter !== "all" ? (eventStatusFilter as "active" | "acknowledged" | "resolved" | "auto_resolved") : undefined,
    limit: 100,
  });

  const linesQuery = trpc.line.list.useQuery();
  const workstationsQuery = trpc.workstation.list.useQuery();
  const productModelsQuery = trpc.productModel.list.useQuery();
  const machinesQuery = trpc.machine.list.useQuery();

  // ── Mutations ──

  const utils = trpc.useUtils();

  const createMutation = trpc.qualityGate.create.useMutation({
    onSuccess: () => {
      toast.success(t('qualityGates.createSuccess'));
      setGateDialogOpen(false);
      resetForm();
      utils.qualityGate.list.invalidate();
    },
    onError: (err) => toast.error(t('qualityGates.failedToCreate', { error: err.message })),
  });

  const updateMutation = trpc.qualityGate.update.useMutation({
    onSuccess: () => {
      toast.success(t('qualityGates.updateSuccess'));
      setGateDialogOpen(false);
      resetForm();
      utils.qualityGate.list.invalidate();
    },
    onError: (err) => toast.error(t('qualityGates.failedToUpdate', { error: err.message })),
  });

  const deleteMutation = trpc.qualityGate.delete.useMutation({
    onSuccess: () => {
      toast.success(t('qualityGates.deleteSuccess'));
      setDeleteConfirmId(null);
      utils.qualityGate.list.invalidate();
    },
    onError: (err) => toast.error(t('qualityGates.failedToDelete', { error: err.message })),
  });

  const acknowledgeMutation = trpc.qualityGate.acknowledgeEvent.useMutation({
    onSuccess: () => {
      toast.success(t('qualityGates.eventAcknowledged'));
      closeEventActionDialog();
      utils.qualityGate.events.invalidate();
      utils.qualityGate.activeEvents.invalidate();
    },
    onError: (err) => toast.error(t('qualityGates.failedToAcknowledge', { error: err.message })),
  });

  const resolveMutation = trpc.qualityGate.resolveEvent.useMutation({
    onSuccess: () => {
      toast.success(t('qualityGates.eventResolved'));
      closeEventActionDialog();
      utils.qualityGate.events.invalidate();
      utils.qualityGate.activeEvents.invalidate();
    },
    onError: (err) => toast.error(t('qualityGates.failedToResolve', { error: err.message })),
  });

  // ── Helpers ──

  function resetForm() {
    setFormData(defaultFormData);
    setEditingGateId(null);
  }

  function openCreateDialog() {
    resetForm();
    setGateDialogOpen(true);
  }

  function openEditDialog(gate: any) {
    setEditingGateId(gate.id);
    setFormData({
      name: gate.name ?? "",
      description: gate.description ?? "",
      gateType: gate.gateType ?? "yield_rate",
      threshold: gate.threshold ?? 95,
      comparisonOperator: gate.comparisonOperator ?? "lt",
      action: gate.action ?? "alert",
      windowSize: gate.windowSize ?? 100,
      consecutiveCount: gate.consecutiveCount ?? 3,
      autoResumeAfterMinutes: gate.autoResumeAfterMinutes ?? null,
      isActive: gate.isActive ?? true,
      lineId: gate.lineId ?? null,
      workstationId: gate.workstationId ?? null,
      productModelId: gate.productModelId ?? null,
      machineId: gate.machineId ?? null,
    });
    setGateDialogOpen(true);
  }

  function handleSubmitGate() {
    if (!formData.name.trim()) {
      toast.error(t('qualityGates.nameRequired'));
      return;
    }
    if (formData.threshold <= 0) {
      toast.error(t('qualityGates.thresholdRequired'));
      return;
    }

    const payload: any = {
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      gateType: formData.gateType as any,
      threshold: formData.threshold,
      comparisonOperator: formData.comparisonOperator as any,
      action: formData.action as any,
      windowSize: formData.windowSize,
      consecutiveCount: formData.gateType === "consecutive_ng" ? formData.consecutiveCount : undefined,
      autoResumeAfterMinutes: formData.autoResumeAfterMinutes ?? undefined,
      isActive: formData.isActive,
      lineId: formData.lineId ?? undefined,
      workstationId: formData.workstationId ?? undefined,
      productModelId: formData.productModelId ?? undefined,
      machineId: formData.machineId ?? undefined,
    };

    if (editingGateId) {
      updateMutation.mutate({ id: editingGateId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function openEventActionDialog(type: "acknowledge" | "resolve", eventId: number) {
    setEventActionDialog({ open: true, type, eventId });
    setEventNotes("");
  }

  function closeEventActionDialog() {
    setEventActionDialog({ open: false, type: "acknowledge", eventId: null });
    setEventNotes("");
  }

  function handleEventAction() {
    if (!eventActionDialog.eventId) return;
    const payload = { id: eventActionDialog.eventId, notes: eventNotes.trim() || undefined };
    if (eventActionDialog.type === "acknowledge") {
      acknowledgeMutation.mutate(payload);
    } else {
      resolveMutation.mutate(payload);
    }
  }

  const activeEventCount = activeEventsQuery.data?.length ?? 0;

  // ── Render ──

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight">{t('qualityGates.title')}</h2>
                <ViewOnlyBadge module="analytics_spc" />
              </div>
              <p className="text-muted-foreground">
                {t('qualityGates.subtitle')}
              </p>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="gates" className="gap-2">
              <Settings className="h-4 w-4" />
              {t('qualityGates.gatesManagement')}
            </TabsTrigger>
            <TabsTrigger value="monitoring" className="gap-2">
              <Eye className="h-4 w-4" />
              {t('qualityGates.liveMonitoring')}
            </TabsTrigger>
            <TabsTrigger value="events" className="gap-2">
              <Activity className="h-4 w-4" />
              {t('qualityGates.eventHistory')}
              {activeEventCount > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 min-w-[20px] px-1.5 text-xs">
                  {activeEventCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ══════════════ Tab 1: Gates Management ══════════════ */}
          <TabsContent value="gates" className="space-y-4">
            <div className="flex justify-end">
              <PermissionGate module="analytics_spc" action="canCreate">
                <Button onClick={openCreateDialog} className="gap-2">
                  <Plus className="h-4 w-4" />
                  {t('qualityGates.createGate')}
                </Button>
              </PermissionGate>
            </div>

            {gatesQuery.isLoading ? (
              <Card>
                <CardContent className="p-6 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </CardContent>
              </Card>
            ) : gatesQuery.data?.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-medium">{t('qualityGates.noGatesConfigured')}</h3>
                  <p className="text-muted-foreground mt-1">{t('qualityGates.noGatesDesc')}</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('qualityGates.name')}</TableHead>
                        <TableHead>{t('qualityGates.type')}</TableHead>
                        <TableHead>{t('qualityGates.threshold')}</TableHead>
                        <TableHead>{t('qualityGates.action')}</TableHead>
                        <TableHead>{t('qualityGates.status')}</TableHead>
                        <TableHead className="text-right">{t('qualityGates.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gatesQuery.data?.map((gate: any) => (
                        <TableRow key={gate.id}>
                          <TableCell className="font-medium">{gate.name}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {GATE_TYPE_LABELS[gate.gateType]?.icon}
                              <span>{t(GATE_TYPE_LABELS[gate.gateType]?.label ?? gate.gateType)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono">
                              {COMPARISON_SYMBOLS[gate.comparisonOperator] ?? "<"}{" "}
                              {gate.threshold}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="gap-1">
                              {ACTION_CONFIG[gate.action]?.icon}
                              {t(ACTION_CONFIG[gate.action]?.label ?? gate.action)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={gate.isActive ? "default" : "secondary"}>
                              {gate.isActive ? t('qualityGates.active') : t('qualityGates.inactive')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <PermissionGate module="analytics_spc" action="canEdit">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => openEditDialog(gate)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </PermissionGate>
                              <PermissionGate module="analytics_spc" action="canDelete">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteConfirmId(gate.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </PermissionGate>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ══════════════ Tab 2: Live Monitoring ══════════════ */}
          <TabsContent value="monitoring" className="space-y-4">
            <Alert>
              <Activity className="h-4 w-4" />
              <AlertDescription>
                {t('qualityGates.monitoringAlert')}
              </AlertDescription>
            </Alert>

            <LiveMonitoringGrid gates={gatesQuery.data ?? []} />
          </TabsContent>

          {/* ══════════════ Tab 3: Event History ══════════════ */}
          <TabsContent value="events" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1.5 min-w-[200px]">
                    <Label>{t('qualityGates.qualityGate')}</Label>
                    <Select value={eventGateFilter} onValueChange={setEventGateFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('qualityGates.allGates')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('qualityGates.allGates')}</SelectItem>
                        {gatesQuery.data?.map((g: any) => (
                          <SelectItem key={g.id} value={String(g.id)}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 min-w-[180px]">
                    <Label>{t('qualityGates.status')}</Label>
                    <Select value={eventStatusFilter} onValueChange={setEventStatusFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('qualityGates.allStatuses')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('qualityGates.allStatuses')}</SelectItem>
                        <SelectItem value="active">{t('qualityGates.statusActive')}</SelectItem>
                        <SelectItem value="acknowledged">{t('qualityGates.statusAcknowledged')}</SelectItem>
                        <SelectItem value="resolved">{t('qualityGates.statusResolved')}</SelectItem>
                        <SelectItem value="auto_resolved">{t('qualityGates.statusAutoResolved')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Events table */}
            {eventsQuery.isLoading ? (
              <Card>
                <CardContent className="p-6 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </CardContent>
              </Card>
            ) : eventsQuery.data?.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <ShieldCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-medium">{t('qualityGates.noEventsFound')}</h3>
                  <p className="text-muted-foreground mt-1">{t('qualityGates.noEventsDesc')}</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('qualityGates.gateName')}</TableHead>
                        <TableHead>{t('qualityGates.triggeredAt')}</TableHead>
                        <TableHead>{t('qualityGates.triggerValue')}</TableHead>
                        <TableHead>{t('qualityGates.threshold')}</TableHead>
                        <TableHead>{t('qualityGates.action')}</TableHead>
                        <TableHead>{t('qualityGates.status')}</TableHead>
                        <TableHead>{t('qualityGates.resolvedAt')}</TableHead>
                        <TableHead>{t('qualityGates.notes')}</TableHead>
                        <TableHead className="text-right">{t('qualityGates.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventsQuery.data?.map((event: any) => {
                        const gateName =
                          gatesQuery.data?.find((g: any) => g.id === event.qualityGateId)?.name ??
                          `Gate #${event.qualityGateId}`;
                        return (
                          <TableRow key={event.id}>
                            <TableCell className="font-medium">{gateName}</TableCell>
                            <TableCell className="text-sm">
                              {event.triggeredAt ? new Date(event.triggeredAt).toLocaleString() : "—"}
                            </TableCell>
                            <TableCell className="font-mono">{event.triggerValue ?? "—"}</TableCell>
                            <TableCell className="font-mono">{event.threshold ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="gap-1">
                                {ACTION_CONFIG[event.action]?.icon}
                                {t(ACTION_CONFIG[event.action]?.label ?? event.action)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={EVENT_STATUS_CLASS[event.status] ?? ""}>
                                {event.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {event.resolvedAt ? new Date(event.resolvedAt).toLocaleString() : "—"}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                              {event.notes ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {event.status === "active" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-yellow-600 hover:text-yellow-700"
                                    title={t('qualityGates.acknowledge')}
                                    onClick={() => openEventActionDialog("acknowledge", event.id)}
                                  >
                                    <AlertTriangle className="h-4 w-4" />
                                  </Button>
                                )}
                                {(event.status === "active" || event.status === "acknowledged") && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-green-600 hover:text-green-700"
                                    title={t('qualityGates.resolve')}
                                    onClick={() => openEventActionDialog("resolve", event.id)}
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ══════════════ Create / Edit Gate Dialog ══════════════ */}
      <Dialog open={gateDialogOpen} onOpenChange={(open) => { if (!open) { setGateDialogOpen(false); resetForm(); } else { setGateDialogOpen(true); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingGateId ? t('qualityGates.editGate') : t('qualityGates.createGateTitle')}</DialogTitle>
            <DialogDescription>
              {editingGateId
                ? t('qualityGates.editGateDesc')
                : t('qualityGates.createGateDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Name & Description */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gate-name">{t('qualityGates.nameLabel')}</Label>
                <Input
                  id="gate-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('qualityGates.namePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gate-desc">{t('qualityGates.descriptionLabel')}</Label>
                <Input
                  id="gate-desc"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('qualityGates.descPlaceholder')}
                />
              </div>
            </div>

            {/* Gate Type & Threshold */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t('qualityGates.gateTypeLabel')}</Label>
                <Select
                  value={formData.gateType}
                  onValueChange={(v) => setFormData({ ...formData, gateType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(GATE_TYPE_LABELS).map(([key, { label, icon }]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">{icon} {t(label)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gate-threshold">{t('qualityGates.thresholdLabel')}</Label>
                <Input
                  id="gate-threshold"
                  type="number"
                  step="any"
                  value={formData.threshold}
                  onChange={(e) => setFormData({ ...formData, threshold: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('qualityGates.comparisonLabel')}</Label>
                <Select
                  value={formData.comparisonOperator}
                  onValueChange={(v) => setFormData({ ...formData, comparisonOperator: v })}
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
            </div>

            {/* Action, Window Size, Consecutive Count */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t('qualityGates.actionLabel')}</Label>
                <Select
                  value={formData.action}
                  onValueChange={(v) => setFormData({ ...formData, action: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACTION_CONFIG).map(([key, { label, icon }]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">{icon} {t(label)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gate-window">{t('qualityGates.windowSize')}</Label>
                <Input
                  id="gate-window"
                  type="number"
                  value={formData.windowSize}
                  onChange={(e) => setFormData({ ...formData, windowSize: Number(e.target.value) })}
                />
              </div>
              {formData.gateType === "consecutive_ng" && (
                <div className="space-y-2">
                  <Label htmlFor="gate-consecutive">{t('qualityGates.consecutiveCount')}</Label>
                  <Input
                    id="gate-consecutive"
                    type="number"
                    value={formData.consecutiveCount}
                    onChange={(e) => setFormData({ ...formData, consecutiveCount: Number(e.target.value) })}
                  />
                </div>
              )}
            </div>

            {/* Auto resume & Active toggle */}
            <div className="grid grid-cols-3 gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="gate-autoresume">{t('qualityGates.autoResumeLabel')}</Label>
                <Input
                  id="gate-autoresume"
                  type="number"
                  placeholder={t('qualityGates.optionalPlaceholder')}
                  value={formData.autoResumeAfterMinutes ?? ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      autoResumeAfterMinutes: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </div>
              <div className="flex items-center gap-3 pb-2">
                <Switch
                  id="gate-active"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
                <Label htmlFor="gate-active">{t('qualityGates.activeLabel')}</Label>
              </div>
            </div>

            {/* Optional filters */}
            <div className="border-t pt-4 mt-2">
              <p className="text-sm font-medium text-muted-foreground mb-3">{t('qualityGates.scopeTitle')}</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('qualityGates.lineLabel')}</Label>
                  <Select
                    value={formData.lineId ? String(formData.lineId) : "none"}
                    onValueChange={(v) => setFormData({ ...formData, lineId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('qualityGates.anyLine')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('qualityGates.anyLine')}</SelectItem>
                      {linesQuery.data?.map((l: any) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          {l.name ?? l.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('qualityGates.workstationLabel')}</Label>
                  <Select
                    value={formData.workstationId ? String(formData.workstationId) : "none"}
                    onValueChange={(v) => setFormData({ ...formData, workstationId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('qualityGates.anyWorkstation')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('qualityGates.anyWorkstation')}</SelectItem>
                      {workstationsQuery.data?.map((w: any) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          {w.name ?? w.code ?? `Workstation #${w.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('qualityGates.productModelLabel')}</Label>
                  <Select
                    value={formData.productModelId ? String(formData.productModelId) : "none"}
                    onValueChange={(v) => setFormData({ ...formData, productModelId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('qualityGates.anyModel')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('qualityGates.anyModel')}</SelectItem>
                      {productModelsQuery.data?.map((pm: any) => (
                        <SelectItem key={pm.id} value={String(pm.id)}>
                          {pm.name ?? pm.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('qualityGates.machineLabel')}</Label>
                  <Select
                    value={formData.machineId ? String(formData.machineId) : "none"}
                    onValueChange={(v) => setFormData({ ...formData, machineId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('qualityGates.anyMachine')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('qualityGates.anyMachine')}</SelectItem>
                      {machinesQuery.data?.map((m: any) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.name ?? m.code ?? `Machine #${m.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setGateDialogOpen(false); resetForm(); }}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmitGate}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) ? t('qualityGates.saving') : editingGateId ? t('qualityGates.update') : t('qualityGates.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════ Delete Confirmation Dialog ══════════════ */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('qualityGates.deleteGate')}</DialogTitle>
            <DialogDescription>
              {t('qualityGates.deleteGateConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteConfirmId) deleteMutation.mutate({ id: deleteConfirmId }); }}
            >
              {deleteMutation.isPending ? t('qualityGates.deleting') : t('qualityGates.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════ Event Action Dialog (Acknowledge / Resolve) ══════════════ */}
      <Dialog open={eventActionDialog.open} onOpenChange={(open) => { if (!open) closeEventActionDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {eventActionDialog.type === "acknowledge" ? t('qualityGates.acknowledgeEvent') : t('qualityGates.resolveEvent')}
            </DialogTitle>
            <DialogDescription>
              {eventActionDialog.type === "acknowledge"
                ? t('qualityGates.acknowledgeDesc')
                : t('qualityGates.resolveDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="event-notes">{t('qualityGates.notesOptional')}</Label>
              <Textarea
                id="event-notes"
                value={eventNotes}
                onChange={(e) => setEventNotes(e.target.value)}
                placeholder={t('qualityGates.notesPlaceholder')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEventActionDialog}>{t('common.cancel')}</Button>
            <Button
              onClick={handleEventAction}
              disabled={acknowledgeMutation.isPending || resolveMutation.isPending}
            >
              {(acknowledgeMutation.isPending || resolveMutation.isPending)
                ? t('qualityGates.processing')
                : eventActionDialog.type === "acknowledge"
                  ? t('qualityGates.acknowledge')
                  : t('qualityGates.resolve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Live Monitoring Sub-component ──

function LiveMonitoringGrid({ gates }: { gates: any[] }) {
  const { t } = useTranslation();
  const activeGates = gates.filter((g: any) => g.isActive);

  if (activeGates.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <ShieldCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">{t('qualityGates.noActiveGates')}</h3>
          <p className="text-muted-foreground mt-1">{t('qualityGates.noActiveGatesDesc')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {activeGates.map((gate: any) => (
        <GateEvaluationCard key={gate.id} gate={gate} />
      ))}
    </div>
  );
}

function GateEvaluationCard({ gate }: { gate: any }) {
  const { t } = useTranslation();
  const evalQuery = trpc.qualityGate.evaluate.useQuery(
    { qualityGateId: gate.id },
    { refetchInterval: 30000 }
  );

  if (evalQuery.isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2 mt-1" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (evalQuery.error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-destructive" />
            {gate.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{t('qualityGates.failedToEvaluate', { error: evalQuery.error.message })}</p>
        </CardContent>
      </Card>
    );
  }

  const data = evalQuery.data;
  const triggered = data?.triggered ?? false;
  const details = data?.details;

  return (
    <Card className={triggered ? "border-red-500 bg-red-50 dark:bg-red-950/20" : "border-green-500 bg-green-50 dark:bg-green-950/20"}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {triggered ? (
              <ShieldAlert className="h-5 w-5 text-red-600" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-green-600" />
            )}
            {gate.name}
          </CardTitle>
          <Badge className={triggered ? "bg-red-600 text-white" : "bg-green-600 text-white"}>
            {triggered ? t('qualityGates.triggered') : t('qualityGates.ok')}
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-2 mt-1">
          {GATE_TYPE_LABELS[data?.gateType ?? gate.gateType]?.icon}
          {GATE_TYPE_LABELS[data?.gateType ?? gate.gateType]?.label ? t(GATE_TYPE_LABELS[data?.gateType ?? gate.gateType].label) : ''}
          {" · "}
          {t('qualityGates.actionPrefix')}: {t(ACTION_CONFIG[data?.action ?? gate.action]?.label ?? '')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Current vs Threshold */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('qualityGates.currentValue')}</span>
          <span className={`font-mono font-bold text-lg ${triggered ? "text-red-600" : "text-green-600"}`}>
            {data?.currentValue != null ? Number(data.currentValue).toFixed(2) : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('qualityGates.thresholdValue')}</span>
          <span className="font-mono font-semibold">{data?.threshold ?? gate.threshold}</span>
        </div>

        {/* Progress bar visualization */}
        {data?.currentValue != null && data?.threshold != null && (
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${triggered ? "bg-red-500" : "bg-green-500"}`}
              style={{
                width: `${Math.min(100, Math.max(0, (Number(data.currentValue) / Number(data.threshold)) * 100))}%`,
              }}
            />
          </div>
        )}

        {data?.message && (
          <p className="text-xs text-muted-foreground italic">{data.message}</p>
        )}

        {/* Details */}
        {details && (
          <div className="border-t pt-3 mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('qualityGates.totalDetail')}:</span>
              <span className="font-mono">{details.total ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('qualityGates.ngCountDetail')}:</span>
              <span className="font-mono">{details.ngCount ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('qualityGates.yieldRateDetail')}:</span>
              <span className="font-mono">
                {details.yieldRate != null ? `${Number(details.yieldRate).toFixed(2)}%` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('qualityGates.ngRateDetail')}:</span>
              <span className="font-mono">
                {details.ngRate != null ? `${Number(details.ngRate).toFixed(2)}%` : "—"}
              </span>
            </div>
            {details.consecutiveNG != null && (
              <div className="flex justify-between col-span-2">
                <span className="text-muted-foreground">{t('qualityGates.consecutiveNgDetail')}:</span>
                <span className="font-mono">{details.consecutiveNG}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function QualityGates() {
  return (
    <DashboardLayout>
      <QualityGatesContent />
    </DashboardLayout>
  );
}
