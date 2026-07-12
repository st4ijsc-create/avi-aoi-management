import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, MetricCard, EmptyState, MachineSelect, ConfirmDeleteDialog } from "@/components/patterns";
import { DataTable } from "@/components/DataTable";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { navItems } from "@/lib/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import {
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3,
  Cpu
} from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";

type Workstation = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  lineId: number | null;
  workshopId: number | null;
  factoryId: number | null;
  processType: string | null;
  orderIndex: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const PROCESS_TYPES = [
  { value: "SMT", color: "bg-primary/15 text-primary border border-primary/30" },
  { value: "DIP", color: "bg-success/15 text-success border border-success/30" },
  { value: "ASSEMBLY", color: "bg-warning/15 text-warning border border-warning/30" },
  { value: "TESTING", color: "bg-info/15 text-info border border-info/30" },
  { value: "PACKAGING", color: "bg-accent text-accent-foreground border border-border" },
  { value: "OTHER", color: "bg-muted text-muted-foreground border border-border" },
];

export default function WorkstationManagement() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("settings_factory", "canCreate");

  // Enum → nhãn tiếng Việt (Đợt 3 dọn locale; inline defaultValue tại đây).
  const processTypeLabel = (value: string | null): string => {
    switch (value) {
      case "SMT": return "SMT";
      case "DIP": return "DIP";
      case "ASSEMBLY": return t("machines.assembly", "Lắp ráp");
      case "TESTING": return t("machines.testing", "Kiểm tra");
      case "PACKAGING": return t("machines.packaging", "Đóng gói");
      default: return t("machines.other", "Khác");
    }
  };

  const [filterLineId, setFilterLineId] = useState<string>("all");
  const [filterFactoryId, setFilterFactoryId] = useState<string>("all");
  const [filterProcessType, setFilterProcessType] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingWorkstation, setEditingWorkstation] = useState<Workstation | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  // doc 42 Đợt 4B (H2) — trạm đang mở panel "Máy thuộc trạm".
  const [machineDialogWs, setMachineDialogWs] = useState<Workstation | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    lineId: "",
    workshopId: "",
    factoryId: "",
    processType: "OTHER",
    orderIndex: 0,
    isActive: true,
  });

  // Queries
  const { data: workstations, isLoading, refetch } = trpc.workstation.list.useQuery({
    lineId: filterLineId !== "all" ? parseInt(filterLineId) : undefined,
    factoryId: filterFactoryId !== "all" ? parseInt(filterFactoryId) : undefined,
  });
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Mutations
  const createMutation = trpc.workstation.create.useMutation({
    onSuccess: () => {
      toast.success(t('machines.createSuccess'));
      refetch();
      setIsCreateDialogOpen(false);
      resetForm();
    },
    onError: (err) => toastTrpcError(err),
  });

  const updateMutation = trpc.workstation.update.useMutation({
    onSuccess: () => {
      toast.success(t('machines.updateSuccess'));
      refetch();
      setEditingWorkstation(null);
      resetForm();
    },
    onError: (err) => toastTrpcError(err),
  });

  const deleteMutation = trpc.workstation.delete.useMutation({
    onSuccess: () => {
      toast.success(t('machines.deleteSuccess'));
      refetch();
      setDeleteConfirmId(null);
    },
    onError: (err) => toastTrpcError(err),
  });

  // Lọc theo loại công đoạn (search/sort/paginate do DataTable đảm nhiệm).
  const filteredWorkstations = useMemo(() => {
    if (!workstations) return [];
    return workstations.filter(
      (ws) => filterProcessType === "all" || ws.processType === filterProcessType,
    );
  }, [workstations, filterProcessType]);

  // Stats
  const stats = useMemo(() => {
    if (!workstations) return { total: 0, active: 0, inactive: 0, byProcessType: {} as Record<string, number> };
    
    const byProcessType: Record<string, number> = {};
    let active = 0;
    let inactive = 0;
    
    workstations.forEach((ws) => {
      if (ws.isActive) active++;
      else inactive++;
      
      const type = ws.processType || "OTHER";
      byProcessType[type] = (byProcessType[type] || 0) + 1;
    });
    
    return { total: workstations.length, active, inactive, byProcessType };
  }, [workstations]);

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      lineId: "",
      workshopId: "",
      factoryId: "",
      processType: "OTHER",
      orderIndex: 0,
      isActive: true,
    });
  };

  const handleCreate = () => {
    createMutation.mutate({
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      lineId: formData.lineId && formData.lineId !== 'none' ? parseInt(formData.lineId) : undefined,
      workshopId: formData.workshopId && formData.workshopId !== 'none' ? parseInt(formData.workshopId) : undefined,
      factoryId: formData.factoryId && formData.factoryId !== 'none' ? parseInt(formData.factoryId) : undefined,
      processType: formData.processType as any,
      orderIndex: formData.orderIndex,
    });
  };

  const handleUpdate = () => {
    if (!editingWorkstation) return;
    
    updateMutation.mutate({
      id: editingWorkstation.id,
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      lineId: formData.lineId && formData.lineId !== 'none' ? parseInt(formData.lineId) : undefined,
      workshopId: formData.workshopId && formData.workshopId !== 'none' ? parseInt(formData.workshopId) : undefined,
      factoryId: formData.factoryId && formData.factoryId !== 'none' ? parseInt(formData.factoryId) : undefined,
      processType: formData.processType as any,
      orderIndex: formData.orderIndex,
      isActive: formData.isActive,
    });
  };

  const openEditDialog = (ws: Workstation) => {
    setEditingWorkstation(ws);
    setFormData({
      code: ws.code,
      name: ws.name,
      description: ws.description || "",
      lineId: ws.lineId?.toString() || "",
      workshopId: ws.workshopId?.toString() || "",
      factoryId: ws.factoryId?.toString() || "",
      processType: ws.processType || "OTHER",
      orderIndex: ws.orderIndex,
      isActive: ws.isActive,
    });
  };

  const getProcessTypeInfo = (type: string | null) => {
    return PROCESS_TYPES.find((pt) => pt.value === type) || PROCESS_TYPES[5];
  };

  const getFactoryName = (factoryId: number | null) => {
    if (!factoryId || !factories) return "-";
    return factories.find((f) => f.id === factoryId)?.name || "-";
  };

  const getLineName = (lineId: number | null) => {
    if (!lineId || !lines) return "-";
    return lines.find((l) => l.id === lineId)?.name || "-";
  };

  return (
    <DashboardLayout navItems={navItems}>
      <PageContainer>
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              {t('machines.title')}<ViewOnlyBadge module="settings_factory" />
            </span>
          }
          description={t('machines.subtitle')}
          actions={
            <PermissionGate module="settings_factory" action="canCreate">
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t('machines.addWorkstation')}
              </Button>
            </PermissionGate>
          }
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard
            label={t('machines.totalWorkstations')}
            value={stats.total}
          />
          <MetricCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label={t('machines.activeStatus')}
            value={stats.active}
            tone="success"
          />
          <MetricCard
            icon={<XCircle className="h-5 w-5" />}
            label={t('machines.pausedStatus')}
            value={stats.inactive}
            tone="danger"
          />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-info" />
                {t('machines.byType')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {Object.entries(stats.byProcessType).map(([type, count]) => (
                  <Badge key={type} variant="secondary" className="text-xs">
                    {processTypeLabel(type)}: {count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('machines.filters')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <Select value={filterFactoryId} onValueChange={setFilterFactoryId}>
                <SelectTrigger className="w-45">
                  <SelectValue placeholder={t('machines.factory')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('machines.allFactories')}</SelectItem>
                  {factories?.map((f) => (
                    <SelectItem key={f.id} value={f.id.toString()}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterLineId} onValueChange={setFilterLineId}>
                <SelectTrigger className="w-45">
                  <SelectValue placeholder={t('machines.line')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('machines.allLines')}</SelectItem>
                  {lines?.map((l) => (
                    <SelectItem key={l.id} value={l.id.toString()}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterProcessType} onValueChange={setFilterProcessType}>
                <SelectTrigger className="w-45">
                  <SelectValue placeholder={t('machines.processType')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('machines.allTypes')}</SelectItem>
                  {PROCESS_TYPES.map((pt) => (
                    <SelectItem key={pt.value} value={pt.value}>
                      {processTypeLabel(pt.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>{t('machines.workstationList')}</CardTitle>
            <CardDescription>
              {t('machines.workstationCount', { count: filteredWorkstations.length })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<Workstation>
              data={filteredWorkstations}
              getRowId={(ws) => ws.id}
              loading={isLoading}
              searchable
              searchPlaceholder={t('machines.searchPlaceholder')}
              initialSort={{ columnId: 'code', dir: 'asc' }}
              emptyState={
                <EmptyState
                  variant="no-data"
                  title={t('machines.noWorkstations')}
                  description={t('machines.noWorkstationsHint', 'Chưa có trạm/máy nào khớp bộ lọc. Thêm trạm mới để bắt đầu.')}
                  actionLabel={canCreate ? t('machines.addWorkstation') : undefined}
                  onAction={canCreate ? () => setIsCreateDialogOpen(true) : undefined}
                />
              }
              columns={[
                { id: 'code', header: t('machines.code'), sortValue: (ws) => ws.code, filterValue: (ws) => `${ws.code} ${ws.name}`, cell: (ws) => <span className="font-mono">{ws.code}</span> },
                { id: 'name', header: t('machines.name'), sortValue: (ws) => ws.name, cell: (ws) => <span className="font-medium">{ws.name}</span> },
                {
                  id: 'type',
                  header: t('machines.type'),
                  sortValue: (ws) => ws.processType ?? '',
                  cell: (ws) => (
                    <Badge variant="outline" className={getProcessTypeInfo(ws.processType).color}>
                      {processTypeLabel(ws.processType)}
                    </Badge>
                  ),
                },
                { id: 'factory', header: t('machines.factory'), sortValue: (ws) => getFactoryName(ws.factoryId), cell: (ws) => getFactoryName(ws.factoryId) },
                { id: 'line', header: t('machines.line'), sortValue: (ws) => getLineName(ws.lineId), cell: (ws) => getLineName(ws.lineId) },
                { id: 'order', header: t('machines.order'), align: 'right', sortValue: (ws) => ws.orderIndex, cell: (ws) => ws.orderIndex.toLocaleString('vi-VN') },
                {
                  id: 'status',
                  header: t('common.status'),
                  sortValue: (ws) => (ws.isActive ? 1 : 0),
                  cell: (ws) => (
                    <Badge variant={ws.isActive ? 'default' : 'secondary'}>
                      {ws.isActive ? t('machines.active') : t('machines.paused')}
                    </Badge>
                  ),
                },
                {
                  id: 'actions',
                  header: '',
                  align: 'right',
                  cell: (ws) => (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setMachineDialogWs(ws)}>
                          <Cpu className="w-4 h-4 mr-2" />
                          {t('machines.assignMachines', 'Gán máy vào trạm')}
                        </DropdownMenuItem>
                        <PermissionGate module="settings_factory" action="canEdit">
                          <DropdownMenuItem onClick={() => openEditDialog(ws)}>
                            <Edit className="w-4 h-4 mr-2" />
                            {t('machines.edit')}
                          </DropdownMenuItem>
                        </PermissionGate>
                        <PermissionGate module="settings_factory" action="canDelete">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteConfirmId(ws.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t('machines.delete')}
                          </DropdownMenuItem>
                        </PermissionGate>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>

        {/* Create/Edit Dialog */}
        <Dialog 
          open={isCreateDialogOpen || !!editingWorkstation} 
          onOpenChange={(open) => {
            if (!open) {
              setIsCreateDialogOpen(false);
              setEditingWorkstation(null);
              resetForm();
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingWorkstation ? t('machines.editWorkstation') : t('machines.addNewWorkstation')}
              </DialogTitle>
              <DialogDescription>
                {editingWorkstation 
                  ? t('machines.editDesc') 
                  : t('machines.createDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">{t('machines.workstationCode')}</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder={t('machines.codePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">{t('machines.workstationName')}</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={t('machines.namePlaceholder')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{t('machines.description')}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('machines.descriptionPlaceholder')}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('machines.processType')}</Label>
                  <Select 
                    value={formData.processType} 
                    onValueChange={(v) => setFormData({ ...formData, processType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROCESS_TYPES.map((pt) => (
                        <SelectItem key={pt.value} value={pt.value}>
                          {processTypeLabel(pt.value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orderIndex">{t('machines.order')}</Label>
                  <Input
                    id="orderIndex"
                    type="number"
                    value={formData.orderIndex}
                    onChange={(e) => setFormData({ ...formData, orderIndex: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('machines.factory')}</Label>
                  <Select 
                    value={formData.factoryId} 
                    onValueChange={(v) => setFormData({ ...formData, factoryId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('machines.selectFactory')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('machines.noSelection')}</SelectItem>
                      {factories?.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('machines.line')}</Label>
                  <Select 
                    value={formData.lineId} 
                    onValueChange={(v) => setFormData({ ...formData, lineId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('machines.selectLine')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('machines.noSelection')}</SelectItem>
                      {lines?.map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="isActive">{t('machines.activeStatusLabel')}</Label>
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsCreateDialogOpen(false);
                  setEditingWorkstation(null);
                  resetForm();
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button 
                onClick={editingWorkstation ? handleUpdate : handleCreate}
                disabled={!formData.code || !formData.name || createMutation.isPending || updateMutation.isPending}
              >
                {editingWorkstation ? t('machines.update') : t('machines.createNew')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* doc 42 Đợt 4B (H2) — panel gán máy vào trạm */}
        <WorkstationMachinesDialog
          workstation={machineDialogWs}
          onOpenChange={(open) => { if (!open) setMachineDialogWs(null); }}
        />

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                {t('machines.confirmDelete')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('machines.deleteConfirmMessage')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
                disabled={deleteMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t('machines.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContainer>
    </DashboardLayout>
  );
}

// ── doc 42 Đợt 4B (H2 — gán máy vào trạm) ────────────────────────────────────
// Nối junction workstation ↔ machine: machinesForWorkstation + assign/unassignMachine.
type AssignedMachine = {
  id: number;
  machineId: number;
  machineCode: string;
  machineName: string;
  machineType: string;
  orderIndex: number;
  assignedAt: Date;
};

function WorkstationMachinesDialog({
  workstation,
  onOpenChange,
}: {
  workstation: Workstation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const workstationId = workstation?.id ?? 0;
  const [machineId, setMachineId] = useState<number | null>(null);

  const { data: assigned, isLoading } = trpc.workstation.machinesForWorkstation.useQuery(
    { workstationId },
    { enabled: !!workstation },
  );

  const invalidate = () => utils.workstation.machinesForWorkstation.invalidate({ workstationId });

  const assignMutation = trpc.workstation.assignMachine.useMutation({
    onSuccess: () => { toast.success(t('machines.assignMachineSuccess', 'Đã gán máy vào trạm')); setMachineId(null); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const unassignMutation = trpc.workstation.unassignMachine.useMutation({
    onSuccess: () => { toast.success(t('machines.unassignMachineSuccess', 'Đã gỡ máy khỏi trạm')); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });

  const rows = (assigned ?? []) as AssignedMachine[];
  const assignedIds = new Set(rows.map((r) => r.machineId));

  const handleAssign = () => {
    if (machineId == null) return;
    if (assignedIds.has(machineId)) { toast.info(t('machines.alreadyAssigned', 'Máy đã được gán vào trạm này')); return; }
    assignMutation.mutate({ workstationId, machineId });
  };

  return (
    <Dialog open={!!workstation} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('machines.assignMachines', 'Gán máy vào trạm')}</DialogTitle>
          <DialogDescription>{workstation ? `${workstation.name} (${workstation.code})` : ''}</DialogDescription>
        </DialogHeader>

        {/* Gán thêm máy — gate canEdit (đổi thành phần trạm) */}
        <PermissionGate module="settings_factory" action="canEdit">
          <div className="rounded-lg border p-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>{t('machines.machine', 'Máy')}</Label>
              <MachineSelect
                value={machineId}
                onChange={(v) => setMachineId(v == null ? null : Number(v))}
                placeholder={t('machines.selectMachine', 'Chọn máy…')}
              />
            </div>
            <Button onClick={handleAssign} disabled={machineId == null || assignMutation.isPending}>
              <Plus className="w-4 h-4 mr-2" />
              {t('machines.assign', 'Gán')}
            </Button>
          </div>
        </PermissionGate>

        <DataTable<AssignedMachine>
          data={rows}
          getRowId={(r) => r.id}
          loading={isLoading}
          paginated={false}
          emptyState={
            <EmptyState
              variant="no-data"
              title={t('machines.noAssignedMachines', 'Chưa gán máy nào')}
              description={t('machines.noAssignedMachinesDesc', 'Chọn máy ở trên để gán vào trạm này.')}
            />
          }
          columns={[
            { id: 'code', header: t('machines.code'), cell: (r) => <span className="font-mono">{r.machineCode}</span> },
            { id: 'name', header: t('machines.name'), cell: (r) => <span className="font-medium">{r.machineName}</span> },
            { id: 'type', header: t('machines.type'), cell: (r) => <Badge variant="outline">{r.machineType}</Badge> },
            {
              id: 'actions',
              header: '',
              align: 'right',
              cell: (r) => (
                <PermissionGate module="settings_factory" action="canEdit">
                  <ConfirmDeleteDialog
                    trigger={
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    }
                    itemLabel={t('machines.assignmentOf', 'gán máy {{code}}', { code: r.machineCode })}
                    isSoftDelete
                    confirmLabel={t('machines.unassign', 'Gỡ khỏi trạm')}
                    title={t('machines.unassignTitle', 'Gỡ máy {{code}} khỏi trạm?', { code: r.machineCode })}
                    description={t('machines.unassignDesc', 'Máy không bị xoá — chỉ gỡ liên kết với trạm này.')}
                    onConfirm={async () => { await unassignMutation.mutateAsync({ workstationId, machineId: r.machineId }); }}
                  />
                </PermissionGate>
              ),
            },
          ]}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close', 'Đóng')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
