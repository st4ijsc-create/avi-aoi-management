import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, EmptyState, LineSelect, EntityPicker, ConfirmDeleteDialog } from "@/components/patterns";
import type { EntityOption } from "@/components/patterns";
import { DataTable } from "@/components/DataTable";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import {
  Plus,
  Edit,
  Trash2,
  GripVertical,
  Workflow,
  Factory,
  Route
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";

const PROCESS_TYPES = [
  { value: 'SMT', label: 'SMT (Surface Mount)', color: 'bg-blue-500' },
  { value: 'DIP', label: 'DIP (Through-hole)', color: 'bg-green-500' },
  { value: 'ASSEMBLY', label: 'Assembly', color: 'bg-purple-500' },
  { value: 'TESTING', label: 'Testing', color: 'bg-orange-500' },
  { value: 'PACKAGING', label: 'Packaging', color: 'bg-pink-500' },
  { value: 'INSPECTION', label: 'Inspection', color: 'bg-yellow-500' },
  { value: 'OTHER', label: 'Other', color: 'bg-gray-500' },
] as const;

type ProcessType = typeof PROCESS_TYPES[number]['value'];

interface ProcessFormData {
  code: string;
  name: string;
  description: string;
  processType: ProcessType;
  cycleTimeTarget: string;
  color: string;
  icon: string;
}

const defaultFormData: ProcessFormData = {
  code: '',
  name: '',
  description: '',
  processType: 'OTHER',
  cycleTimeTarget: '',
  color: '#3b82f6',
  icon: '',
};

// Sortable Process Item Component
function SortableProcessItem({
  process,
  index,
  onEdit,
  onDelete,
  onAssign,
  getProcessTypeInfo
}: {
  process: any;
  index: number;
  onEdit: (process: any) => void;
  onDelete: (id: number) => void;
  onAssign: (process: any) => void;
  getProcessTypeInfo: (type: string) => { value: string; label: string; color: string };
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: process.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const typeInfo = getProcessTypeInfo(process.processType);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors ${
        isDragging ? 'shadow-lg bg-background z-50' : ''
      }`}
    >
      <div 
        className="cursor-grab text-muted-foreground hover:text-foreground touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </div>
      <div 
        className="flex items-center justify-center w-10 h-10 rounded-lg text-white font-bold"
        style={{ backgroundColor: process.color || '#3b82f6' }}
      >
        {index + 1}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{process.name}</span>
          <Badge variant="outline" className="font-mono text-xs">
            {process.code}
          </Badge>
          <Badge className={`${typeInfo.color} text-white`}>
            {typeInfo.label}
          </Badge>
          {!process.isActive && (
            <Badge variant="secondary">{t('process.inactive')}</Badge>
          )}
        </div>
        {process.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {process.description}
          </p>
        )}
        {process.cycleTimeTarget && (
          <p className="text-xs text-muted-foreground mt-1">
            {t('process.targetCycleTimeLabel')}: {process.cycleTimeTarget}s
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onAssign(process)}
          title={t('process.assignToLine', 'Gán vào dây chuyền / trạm')}
        >
          <Route className="h-4 w-4" />
        </Button>
        <PermissionGate module="settings_factory" action="canEdit">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(process)}
        >
          <Edit className="h-4 w-4" />
        </Button>
        </PermissionGate>
        <PermissionGate module="settings_factory" action="canDelete">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(process.id)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        </PermissionGate>
      </div>
    </div>
  );
}

export function ProcessManagementContent() {
  const { t } = useTranslation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<number | null>(null);
  const [formData, setFormData] = useState<ProcessFormData>(defaultFormData);
  const [filterType, setFilterType] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  // doc 42 Đợt 4B (H2) — quy trình đang mở panel "Gán vào dây chuyền/trạm".
  const [assignProcess, setAssignProcess] = useState<{ id: number; name: string } | null>(null);

  const utils = trpc.useUtils();

  // Fetch processes
  const { data: processes, isLoading, isError, error, refetch } = trpc.process.list.useQuery(
    filterType !== "all" ? { processType: filterType as ProcessType } : undefined
  );

  // Mutations
  const createMutation = trpc.process.create.useMutation({
    onSuccess: () => {
      toast.success(t('process.createSuccess'));
      setIsCreateDialogOpen(false);
      setFormData(defaultFormData);
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  const updateMutation = trpc.process.update.useMutation({
    onSuccess: () => {
      toast.success(t('process.updateSuccess'));
      setIsEditDialogOpen(false);
      setSelectedProcess(null);
      setFormData(defaultFormData);
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  const deleteMutation = trpc.process.delete.useMutation({
    onSuccess: () => {
      toast.success(t('process.deleteSuccess'));
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  const reorderMutation = trpc.process.reorder.useMutation({
    onSuccess: () => {
      toast.success(t('process.reorderSuccess'));
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sorted processes for drag-drop
  const sortedProcesses = useMemo(() => {
    if (!processes) return [];
    return [...processes].sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
  }, [processes]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sortedProcesses.findIndex((p) => p.id === active.id);
      const newIndex = sortedProcesses.findIndex((p) => p.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(sortedProcesses, oldIndex, newIndex);
        const orderedIds = newOrder.map((p) => p.id);
        reorderMutation.mutate({ orderedIds });
      }
    }
  };

  const handleCreate = () => {
    createMutation.mutate({
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      processType: formData.processType,
      cycleTimeTarget: formData.cycleTimeTarget ? Number(formData.cycleTimeTarget) : undefined,
      color: formData.color,
      icon: formData.icon || undefined,
    });
  };

  const handleUpdate = () => {
    if (!selectedProcess) return;
    updateMutation.mutate({
      id: selectedProcess,
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      processType: formData.processType,
      cycleTimeTarget: formData.cycleTimeTarget ? Number(formData.cycleTimeTarget) : undefined,
      color: formData.color,
      icon: formData.icon || undefined,
    });
  };

  const handleDelete = (id: number) => {
    setDeleteId(id);
  };

  const confirmDelete = () => {
    if (deleteId != null) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
    }
  };

  const handleEdit = (process: NonNullable<typeof processes>[number]) => {
    setSelectedProcess(process.id);
    setFormData({
      code: process.code,
      name: process.name,
      description: process.description || '',
      processType: process.processType as ProcessType,
      cycleTimeTarget: process.cycleTimeTarget || '',
      color: process.color || '#3b82f6',
      icon: process.icon || '',
    });
    setIsEditDialogOpen(true);
  };

  const getProcessTypeInfo = (type: string) => {
    return PROCESS_TYPES.find(t => t.value === type) || PROCESS_TYPES[PROCESS_TYPES.length - 1];
  };

  return (
    <div className="space-y-6">
      {/* Header — DS PageHeader (shared pattern) */}
      <PageHeader
        icon={<Workflow className="h-6 w-6" />}
        title={t('process.title')}
        description={t('process.subtitle')}
        badge={<ViewOnlyBadge module="settings_factory" />}
        actions={
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <PermissionGate module="settings_factory" action="canCreate">
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {t('process.addProcess')}
              </Button>
            </DialogTrigger>
            </PermissionGate>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t('process.createTitle')}</DialogTitle>
                <DialogDescription>
                  {t('process.createDesc')}
                </DialogDescription>
              </DialogHeader>
              <ProcessForm
                formData={formData}
                setFormData={setFormData}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? t('process.creating') : t('process.create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Label>{t('process.filterByType')}:</Label>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t('process.allTypes')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('process.allTypes')}</SelectItem>
                {PROCESS_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Process List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('process.productionProcesses')}</CardTitle>
          <CardDescription>
            {t('process.dragDropDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AsyncBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            isEmpty={sortedProcesses.length === 0}
            onRetry={() => refetch()}
            preset="list"
            errorTitle={t('process.loadError', 'Không tải được danh sách quy trình')}
            retryLabel={t('common.retry', 'Thử lại')}
            emptyState={
              <EmptyState
                icon={Factory}
                title={t('process.noProcesses')}
                description={t('process.noProcessesDesc')}
              />
            }
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedProcesses.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {sortedProcesses.map((process, index) => (
                    <SortableProcessItem
                      key={process.id}
                      process={process}
                      index={index}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onAssign={(p) => setAssignProcess({ id: p.id, name: p.name })}
                      getProcessTypeInfo={getProcessTypeInfo}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </AsyncBoundary>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('process.editTitle')}</DialogTitle>
            <DialogDescription>
              {t('process.editDesc')}
            </DialogDescription>
          </DialogHeader>
          <ProcessForm 
            formData={formData} 
            setFormData={setFormData} 
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('process.saving') : t('process.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId != null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('process.deleteTitle', 'Delete process')}</AlertDialogTitle>
            <AlertDialogDescription>{t('process.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* doc 42 Đợt 4B (H2) — panel gán quy trình vào dây chuyền/trạm */}
      <ProcessLineAssignmentDialog
        process={assignProcess}
        onOpenChange={(open) => { if (!open) setAssignProcess(null); }}
      />
    </div>
  );
}

export default function ProcessManagement() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t('process.title')}>
      <PageContainer>
        <ProcessManagementContent />
      </PageContainer>
    </DashboardLayout>
  );
}

// Process Form Component
function ProcessForm({ 
  formData, 
  setFormData 
}: { 
  formData: ProcessFormData; 
  setFormData: React.Dispatch<React.SetStateAction<ProcessFormData>>;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="code">{t('process.code')}</Label>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
            placeholder={t('process.codePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="processType">{t('process.type')}</Label>
          <Select 
            value={formData.processType} 
            onValueChange={(v) => setFormData(prev => ({ ...prev, processType: v as ProcessType }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROCESS_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="name">{t('process.name')}</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder={t('process.namePlaceholder')}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="description">{t('process.description')}</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder={t('process.descriptionPlaceholder')}
        />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cycleTimeTarget">{t('process.targetCycleTime')}</Label>
          <Input
            id="cycleTimeTarget"
            type="number"
            value={formData.cycleTimeTarget}
            onChange={(e) => setFormData(prev => ({ ...prev, cycleTimeTarget: e.target.value }))}
            placeholder={t('process.cycleTimePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="color">{t('process.color')}</Label>
          <div className="flex gap-2">
            <Input
              id="color"
              type="color"
              value={formData.color}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              className="w-12 h-10 p-1"
            />
            <Input
              value={formData.color}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              placeholder="#3b82f6"
              className="flex-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── doc 42 Đợt 4B (H2 #process→line) — panel gán quy trình vào dây chuyền/trạm ──
// Nối API mồ côi processRouter.getAssignmentsByProcess + create/update/deleteLineAssignment.
type ProcessAssignment = {
  id: number;
  lineId: number;
  lineName: string | null;
  lineCode: string | null;
  stationId: number | null;
  stationName: string | null;
  stationCode: string | null;
  orderIndex: number;
  cycleTimeTarget: string | null;
  isActive: boolean;
};

const emptyAssignForm = { lineId: null as number | null, stationId: null as number | null, orderIndex: "0", cycleTimeTarget: "" };

function ProcessLineAssignmentDialog({
  process,
  onOpenChange,
}: {
  process: { id: number; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const processId = process?.id ?? 0;

  const [form, setForm] = useState(emptyAssignForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: assignments, isLoading } = trpc.process.getAssignmentsByProcess.useQuery(
    { processId },
    { enabled: !!process },
  );
  const { data: stations } = trpc.station.list.useQuery(undefined, { enabled: !!process });

  const stationOptions: EntityOption[] = useMemo(() => {
    if (!stations || form.lineId == null) return [];
    return stations
      .filter((s: any) => s.lineId === form.lineId)
      .map((s: any) => ({ value: s.id, label: s.name, sublabel: s.code ?? undefined }));
  }, [stations, form.lineId]);

  const resetForm = () => { setForm(emptyAssignForm); setEditingId(null); };

  const invalidate = () => utils.process.getAssignmentsByProcess.invalidate({ processId });

  const createMutation = trpc.process.createLineAssignment.useMutation({
    onSuccess: () => { toast.success(t('process.assignSuccess', 'Đã gán quy trình vào dây chuyền')); resetForm(); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const updateMutation = trpc.process.updateLineAssignment.useMutation({
    onSuccess: () => { toast.success(t('process.assignUpdateSuccess', 'Đã cập nhật gán')); resetForm(); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const deleteMutation = trpc.process.deleteLineAssignment.useMutation({
    onSuccess: () => { toast.success(t('process.assignDeleteSuccess', 'Đã gỡ gán')); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });

  const handleSubmit = () => {
    const orderIndex = Number(form.orderIndex) || 0;
    const cycleTimeTarget = form.cycleTimeTarget ? Number(form.cycleTimeTarget) : undefined;
    const stationId = form.stationId ?? undefined;
    if (editingId != null) {
      updateMutation.mutate({ id: editingId, orderIndex, cycleTimeTarget, stationId });
    } else {
      if (form.lineId == null) return;
      createMutation.mutate({ lineId: form.lineId, processId, orderIndex, cycleTimeTarget, stationId });
    }
  };

  const startEdit = (a: ProcessAssignment) => {
    setEditingId(a.id);
    setForm({
      lineId: a.lineId,
      stationId: a.stationId,
      orderIndex: String(a.orderIndex),
      cycleTimeTarget: a.cycleTimeTarget ?? "",
    });
  };

  const rows = (assignments ?? []) as ProcessAssignment[];
  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={!!process} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('process.assignToLine', 'Gán vào dây chuyền / trạm')}</DialogTitle>
          <DialogDescription>{process?.name}</DialogDescription>
        </DialogHeader>

        {/* Form thêm / sửa gán — gate canCreate (thêm) / canEdit (sửa) */}
        <PermissionGate module="settings_factory" action={editingId != null ? "canEdit" : "canCreate"}>
          <div className="rounded-lg border p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('process.line', 'Dây chuyền')}</Label>
                <LineSelect
                  value={form.lineId}
                  onChange={(v) => setForm((p) => ({ ...p, lineId: v == null ? null : Number(v), stationId: null }))}
                  disabled={editingId != null}
                  placeholder={t('process.selectLine', 'Chọn dây chuyền…')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('process.station', 'Trạm (tuỳ chọn)')}</Label>
                <EntityPicker
                  options={stationOptions}
                  value={form.stationId}
                  onChange={(v) => setForm((p) => ({ ...p, stationId: v == null ? null : Number(v) }))}
                  disabled={form.lineId == null}
                  placeholder={t('process.selectStation', 'Chọn trạm…')}
                  emptyText={t('process.noStationForLine', 'Dây chuyền chưa có trạm')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('process.order', 'Thứ tự')}</Label>
                <Input
                  type="number"
                  value={form.orderIndex}
                  onChange={(e) => setForm((p) => ({ ...p, orderIndex: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('process.targetCycleTime', 'Chu kỳ mục tiêu (giây)')}</Label>
                <Input
                  type="number"
                  value={form.cycleTimeTarget}
                  onChange={(e) => setForm((p) => ({ ...p, cycleTimeTarget: e.target.value }))}
                  placeholder={t('process.cycleTimePlaceholder', 'Bỏ trống = dùng mặc định')}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {editingId != null && (
                <Button variant="outline" onClick={resetForm}>{t('common.cancel', 'Huỷ')}</Button>
              )}
              <Button
                onClick={handleSubmit}
                disabled={submitting || (editingId == null && form.lineId == null)}
              >
                <Plus className="h-4 w-4 mr-2" />
                {editingId != null ? t('process.saveChanges', 'Lưu thay đổi') : t('process.addAssignment', 'Thêm gán')}
              </Button>
            </div>
          </div>
        </PermissionGate>

        <DataTable<ProcessAssignment>
          data={rows}
          getRowId={(r) => r.id}
          loading={isLoading}
          paginated={false}
          emptyState={
            <EmptyState
              icon={Route}
              title={t('process.noAssignments', 'Chưa gán vào dây chuyền nào')}
              description={t('process.noAssignmentsDesc', 'Chọn dây chuyền ở trên để gán quy trình này.')}
            />
          }
          columns={[
            {
              id: 'line',
              header: t('process.line', 'Dây chuyền'),
              cell: (r) => (
                <span className="flex items-center gap-2">
                  <span className="font-medium">{r.lineName ?? `#${r.lineId}`}</span>
                  {r.lineCode && <Badge variant="outline" className="font-mono text-xs">{r.lineCode}</Badge>}
                </span>
              ),
            },
            {
              id: 'station',
              header: t('process.station', 'Trạm'),
              cell: (r) => r.stationId
                ? <span className="flex items-center gap-2">{r.stationName ?? `#${r.stationId}`}{r.stationCode && <Badge variant="outline" className="font-mono text-xs">{r.stationCode}</Badge>}</span>
                : <span className="text-muted-foreground">—</span>,
            },
            { id: 'order', header: t('process.order', 'Thứ tự'), align: 'right', cell: (r) => r.orderIndex },
            { id: 'cycle', header: t('process.targetCycleTimeLabel', 'Chu kỳ (s)'), align: 'right', cell: (r) => r.cycleTimeTarget ?? '—' },
            {
              id: 'actions',
              header: '',
              align: 'right',
              cell: (r) => (
                <div className="flex items-center justify-end gap-1">
                  <PermissionGate module="settings_factory" action="canEdit">
                    <Button variant="ghost" size="icon" onClick={() => startEdit(r)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                  </PermissionGate>
                  <PermissionGate module="settings_factory" action="canDelete">
                    <ConfirmDeleteDialog
                      trigger={
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      }
                      itemLabel={t('process.assignmentLabel', 'gán vào {{line}}', { line: r.lineName ?? `#${r.lineId}` })}
                      onConfirm={async () => { await deleteMutation.mutateAsync({ id: r.id }); }}
                    />
                  </PermissionGate>
                </div>
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
