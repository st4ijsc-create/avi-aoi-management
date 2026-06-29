import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { 
  Plus, 
  Edit, 
  Trash2, 
  GripVertical,
  Workflow,
  Factory
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
  getProcessTypeInfo 
}: { 
  process: any; 
  index: number; 
  onEdit: (process: any) => void; 
  onDelete: (id: number) => void;
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
          className="text-red-500 hover:text-red-600"
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

  const utils = trpc.useUtils();

  // Fetch processes
  const { data: processes, isLoading } = trpc.process.list.useQuery(
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
      toast.error(error.message);
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
      toast.error(error.message);
    },
  });

  const deleteMutation = trpc.process.delete.useMutation({
    onSuccess: () => {
      toast.success(t('process.deleteSuccess'));
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const reorderMutation = trpc.process.reorder.useMutation({
    onSuccess: () => {
      toast.success(t('process.reorderSuccess'));
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
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
    if (confirm(t('process.deleteConfirm'))) {
      deleteMutation.mutate({ id });
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
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Workflow className="h-6 w-6" />
            {t('process.title')}
            <ViewOnlyBadge module="settings_factory" />
          </h1>
          <p className="text-muted-foreground">
            {t('process.subtitle')}
          </p>
        </div>
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
      </div>

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
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : sortedProcesses.length > 0 ? (
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
                      getProcessTypeInfo={getProcessTypeInfo}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Factory className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('process.noProcesses')}</p>
              <p className="text-sm">{t('process.noProcessesDesc')}</p>
            </div>
          )}
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
    </div>
  );
}

export default function ProcessManagement() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t('process.title')}>
      <ProcessManagementContent />
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
