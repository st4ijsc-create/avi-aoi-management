import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Settings2,
  GripVertical,
  BarChart3,
  Activity,
  TrendingUp,
  AlertTriangle,
  Factory,
  Gauge,
  Clock,
  Target,
  type LucideIcon,
} from 'lucide-react';

// Widget definitions
export const WIDGET_DEFINITIONS: Record<string, {
  id: string;
  name: string;
  nameVi: string;
  nameZh: string;
  description: string;
  icon: LucideIcon;
  defaultVisible: boolean;
  defaultOrder: number;
  minWidth: number;
  minHeight: number;
}> = {
  kpiCards: {
    id: 'kpiCards',
    name: 'KPI Cards',
    nameVi: 'Thẻ KPI',
    nameZh: 'KPI卡片',
    description: 'Total inspections, OK/NG/NTF counts, yield rate',
    icon: Gauge,
    defaultVisible: true,
    defaultOrder: 1,
    minWidth: 2,
    minHeight: 1,
  },
  trendChart: {
    id: 'trendChart',
    name: 'Trend Chart',
    nameVi: 'Biểu đồ xu hướng',
    nameZh: '趋势图',
    description: '7-day yield rate trend',
    icon: TrendingUp,
    defaultVisible: true,
    defaultOrder: 2,
    minWidth: 2,
    minHeight: 2,
  },
  machineStatus: {
    id: 'machineStatus',
    name: 'Machine Status',
    nameVi: 'Trạng thái máy',
    nameZh: '设备状态',
    description: 'Real-time machine status overview',
    icon: Activity,
    defaultVisible: true,
    defaultOrder: 3,
    minWidth: 2,
    minHeight: 2,
  },
  topMachines: {
    id: 'topMachines',
    name: 'Top Machines',
    nameVi: 'Top máy',
    nameZh: 'Top设备',
    description: 'Best and worst performing machines',
    icon: BarChart3,
    defaultVisible: true,
    defaultOrder: 4,
    minWidth: 1,
    minHeight: 2,
  },
  alerts: {
    id: 'alerts',
    name: 'Active Alerts',
    nameVi: 'Cảnh báo',
    nameZh: '活动告警',
    description: 'Current active alerts and warnings',
    icon: AlertTriangle,
    defaultVisible: true,
    defaultOrder: 5,
    minWidth: 1,
    minHeight: 1,
  },
  factoryStats: {
    id: 'factoryStats',
    name: 'Factory Statistics',
    nameVi: 'Thống kê nhà máy',
    nameZh: '工厂统计',
    description: 'Production statistics by factory',
    icon: Factory,
    defaultVisible: true,
    defaultOrder: 6,
    minWidth: 2,
    minHeight: 2,
  },
  recentInspections: {
    id: 'recentInspections',
    name: 'Recent Inspections',
    nameVi: 'Kiểm tra gần đây',
    nameZh: '最近检测',
    description: 'Latest inspection results',
    icon: Clock,
    defaultVisible: true,
    defaultOrder: 7,
    minWidth: 2,
    minHeight: 1,
  },
  shiftStats: {
    id: 'shiftStats',
    name: 'Shift Statistics',
    nameVi: 'Thống kê ca',
    nameZh: '班次统计',
    description: 'Production by shift',
    icon: Target,
    defaultVisible: false,
    defaultOrder: 8,
    minWidth: 1,
    minHeight: 1,
  },
};

export type WidgetId = keyof typeof WIDGET_DEFINITIONS;

export interface WidgetConfig {
  id: string;
  type: string;
  title: string;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  settings?: Record<string, unknown>;
}

// Sortable widget item component
function SortableWidgetItem({
  widget,
  onToggle,
  language,
}: {
  widget: WidgetConfig;
  onToggle: (id: string, visible: boolean) => void;
  language: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const def = WIDGET_DEFINITIONS[widget.id];
  if (!def) return null;
  
  const Icon = def.icon;
  
  const getName = () => {
    if (language === 'vi') return def.nameVi;
    if (language === 'zh') return def.nameZh;
    return def.name;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-lg border bg-card ${
        isDragging ? 'shadow-lg' : ''
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <Icon className="h-5 w-5 text-primary" />
      <div className="flex-1">
        <p className="font-medium text-sm">{getName()}</p>
        <p className="text-xs text-muted-foreground">{def.description}</p>
      </div>
      <Switch
        checked={widget.visible}
        onCheckedChange={(checked) => onToggle(widget.id, checked)}
      />
    </div>
  );
}

export function DashboardWidgetManager({
  onLayoutChange,
}: {
  onLayoutChange?: (widgets: WidgetConfig[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch saved layout
  const { data: savedLayout, refetch } = trpc.dashboardWidget.getLayout.useQuery(undefined, {
    enabled: !!user,
  });

  // Save layout mutation
  const saveLayoutMutation = trpc.dashboardWidget.saveLayout.useMutation({
    onSuccess: () => {
      toast.success(t('common.success'));
      setHasChanges(false);
      refetch();
    },
    onError: () => {
      toast.error(t('common.error'));
    },
  });

  // Reset to default mutation
  const resetLayoutMutation = trpc.dashboardWidget.resetLayout.useMutation({
    onSuccess: () => {
      toast.success(t('common.success'));
      refetch();
    },
  });

  // Initialize widgets from saved layout or defaults
  useEffect(() => {
    if (savedLayout && savedLayout.widgets && savedLayout.widgets.length > 0) {
      setWidgets(savedLayout.widgets);
    } else {
      // Initialize with defaults
      const defaultWidgets: WidgetConfig[] = Object.values(WIDGET_DEFINITIONS).map((def, index) => ({
        id: def.id,
        type: def.id,
        title: def.name,
        visible: def.defaultVisible,
        x: 0,
        y: index,
        w: def.minWidth,
        h: def.minHeight,
      }));
      setWidgets(defaultWidgets);
    }
  }, [savedLayout]);

  // Notify parent of layout changes
  useEffect(() => {
    if (onLayoutChange) {
      onLayoutChange(widgets);
    }
  }, [widgets, onLayoutChange]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setWidgets((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex).map((item, index) => ({
          ...item,
          y: index,
        }));
        setHasChanges(true);
        return newItems;
      });
    }
  };

  const handleToggle = (id: string, visible: boolean) => {
    setWidgets((items) =>
      items.map((item) => (item.id === id ? { ...item, visible } : item))
    );
    setHasChanges(true);
  };

  const handleSave = () => {
    saveLayoutMutation.mutate({ widgets });
  };

  const handleReset = () => {
    resetLayoutMutation.mutate();
    setHasChanges(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings2 className="h-4 w-4" />
          {t('common.settings')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Dashboard Widgets</DialogTitle>
          <DialogDescription>
            Drag to reorder, toggle to show/hide widgets
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto py-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={widgets.map((w) => w.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {widgets.map((widget) => (
                  <SortableWidgetItem
                    key={widget.id}
                    widget={widget}
                    onToggle={handleToggle}
                    language={i18n.language}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || saveLayoutMutation.isPending}>
              {saveLayoutMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Hook to get visible widgets in order
export function useVisibleWidgets() {
  const { user } = useAuth();
  const { data: savedLayout } = trpc.dashboardWidget.getLayout.useQuery(undefined, {
    enabled: !!user,
  });

  const [visibleWidgets, setVisibleWidgets] = useState<string[]>([]);

  useEffect(() => {
    if (savedLayout && savedLayout.widgets && savedLayout.widgets.length > 0) {
      const visible = savedLayout.widgets
        .filter((w) => w.visible)
        .sort((a, b) => a.y - b.y)
        .map((w) => w.id);
      setVisibleWidgets(visible);
    } else {
      // Default visible widgets
      const defaultVisible = Object.values(WIDGET_DEFINITIONS)
        .filter((def) => def.defaultVisible)
        .sort((a, b) => a.defaultOrder - b.defaultOrder)
        .map((def) => def.id);
      setVisibleWidgets(defaultVisible);
    }
  }, [savedLayout]);

  return visibleWidgets;
}
