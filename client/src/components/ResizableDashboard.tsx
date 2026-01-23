import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Responsive, type LayoutItem, type ResponsiveLayouts, type Layout, type Breakpoint } from 'react-grid-layout';
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
  Maximize2,
  Lock,
  Unlock,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import 'react-grid-layout/css/styles.css';

// Widget definitions with default sizes
export const WIDGET_DEFINITIONS: Record<string, {
  id: string;
  name: string;
  nameVi: string;
  nameZh: string;
  description: string;
  icon: LucideIcon;
  defaultVisible: boolean;
  defaultOrder: number;
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
  maxW?: number;
  maxH?: number;
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
    minW: 2,
    minH: 1,
    defaultW: 4,
    defaultH: 1,
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
    minW: 2,
    minH: 2,
    defaultW: 2,
    defaultH: 2,
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
    minW: 2,
    minH: 2,
    defaultW: 2,
    defaultH: 2,
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
    minW: 1,
    minH: 2,
    defaultW: 2,
    defaultH: 2,
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
    minW: 1,
    minH: 1,
    defaultW: 2,
    defaultH: 2,
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
    minW: 2,
    minH: 2,
    defaultW: 2,
    defaultH: 2,
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
    minW: 2,
    minH: 1,
    defaultW: 4,
    defaultH: 2,
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
    minW: 1,
    minH: 1,
    defaultW: 2,
    defaultH: 2,
  },
};

interface ResizableDashboardProps {
  children: (widgetId: string) => React.ReactNode;
}

// Default layouts for different breakpoints
const generateDefaultLayouts = (): ResponsiveLayouts => {
  const visibleWidgets = Object.values(WIDGET_DEFINITIONS).filter(w => w.defaultVisible);
  
  const lgLayout: LayoutItem[] = [];
  let currentY = 0;
  let currentX = 0;
  const cols = 4;
  
  visibleWidgets.forEach((widget) => {
    if (currentX + widget.defaultW > cols) {
      currentX = 0;
      currentY += 2;
    }
    
    lgLayout.push({
      i: widget.id,
      x: currentX,
      y: currentY,
      w: widget.defaultW,
      h: widget.defaultH,
      minW: widget.minW,
      minH: widget.minH,
    });
    
    currentX += widget.defaultW;
  });
  
  // Generate responsive layouts
  const mdLayout = lgLayout.map(item => ({
    ...item,
    w: Math.min(item.w, 3),
    x: item.x % 3,
  }));
  
  const smLayout = lgLayout.map(item => ({
    ...item,
    w: 2,
    x: 0,
  }));
  
  const xsLayout = lgLayout.map(item => ({
    ...item,
    w: 1,
    x: 0,
  }));
  
  return {
    lg: lgLayout,
    md: mdLayout,
    sm: smLayout,
    xs: xsLayout,
  };
};

export function ResizableDashboard({ children }: ResizableDashboardProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(generateDefaultLayouts);
  const [visibleWidgets, setVisibleWidgets] = useState<Set<string>>(
    new Set(Object.values(WIDGET_DEFINITIONS).filter(w => w.defaultVisible).map(w => w.id))
  );
  const [isLocked, setIsLocked] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1200);

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

  // Reset layout mutation
  const resetLayoutMutation = trpc.dashboardWidget.resetLayout.useMutation({
    onSuccess: () => {
      toast.success(t('common.success'));
      setLayouts(generateDefaultLayouts());
      setVisibleWidgets(new Set(Object.values(WIDGET_DEFINITIONS).filter(w => w.defaultVisible).map(w => w.id)));
      refetch();
    },
  });

  // Load saved layout
  useEffect(() => {
    if (savedLayout && savedLayout.widgets && savedLayout.widgets.length > 0) {
      const loadedLayouts: ResponsiveLayouts = { lg: [], md: [], sm: [], xs: [] };
      const visible = new Set<string>();
      
      savedLayout.widgets.forEach((widget) => {
        if (widget.visible) {
          visible.add(widget.id);
        }
        
        const def = WIDGET_DEFINITIONS[widget.id];
        if (!def) return;
        
        const layoutItem: LayoutItem = {
          i: widget.id,
          x: widget.x,
          y: widget.y,
          w: widget.w,
          h: widget.h,
          minW: def.minW,
          minH: def.minH,
        };
        
        loadedLayouts.lg = [...(loadedLayouts.lg || []), layoutItem];
        loadedLayouts.md = [...(loadedLayouts.md || []), { ...layoutItem, w: Math.min(layoutItem.w, 3), x: layoutItem.x % 3 }];
        loadedLayouts.sm = [...(loadedLayouts.sm || []), { ...layoutItem, w: 2, x: 0 }];
        loadedLayouts.xs = [...(loadedLayouts.xs || []), { ...layoutItem, w: 1, x: 0 }];
      });
      
      if ((loadedLayouts.lg?.length || 0) > 0) {
        setLayouts(loadedLayouts);
        setVisibleWidgets(visible);
      }
    }
  }, [savedLayout]);

  const handleLayoutChange = useCallback((currentLayout: Layout, allLayouts: ResponsiveLayouts) => {
    setLayouts(allLayouts);
    setHasChanges(true);
  }, []);

  const handleToggleWidget = useCallback((widgetId: string, visible: boolean) => {
    setVisibleWidgets(prev => {
      const next = new Set(prev);
      if (visible) {
        next.add(widgetId);
        // Add to layouts if not present
        const def = WIDGET_DEFINITIONS[widgetId];
        const lgLayout = layouts.lg || [];
        if (def && !lgLayout.find((l: LayoutItem) => l.i === widgetId)) {
          const maxY = Math.max(...lgLayout.map((l: LayoutItem) => l.y + l.h), 0);
          const newItem: LayoutItem = {
            i: widgetId,
            x: 0,
            y: maxY,
            w: def.defaultW,
            h: def.defaultH,
            minW: def.minW,
            minH: def.minH,
          };
          setLayouts(prev => ({
            lg: [...(prev.lg || []), newItem],
            md: [...(prev.md || []), { ...newItem, w: Math.min(newItem.w, 3) }],
            sm: [...(prev.sm || []), { ...newItem, w: 2, x: 0 }],
            xs: [...(prev.xs || []), { ...newItem, w: 1, x: 0 }],
          }));
        }
      } else {
        next.delete(widgetId);
      }
      return next;
    });
    setHasChanges(true);
  }, [layouts]);

  const handleSave = useCallback(() => {
    const lgLayout = layouts.lg || [];
    const widgets = lgLayout.map((item: LayoutItem) => {
      const def = WIDGET_DEFINITIONS[item.i];
      return {
        id: item.i,
        type: item.i,
        title: def?.name || item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        visible: visibleWidgets.has(item.i),
      };
    });
    
    saveLayoutMutation.mutate({ widgets });
  }, [layouts, visibleWidgets, saveLayoutMutation]);

  const handleReset = useCallback(() => {
    resetLayoutMutation.mutate();
  }, [resetLayoutMutation]);

  const getWidgetName = useCallback((id: string) => {
    const def = WIDGET_DEFINITIONS[id];
    if (!def) return id;
    if (i18n.language === 'vi') return def.nameVi;
    if (i18n.language === 'zh') return def.nameZh;
    return def.name;
  }, [i18n.language]);

  // Filter layouts to only show visible widgets
  const visibleLayouts = useMemo(() => {
    const filtered: ResponsiveLayouts = {
      lg: (layouts.lg || []).filter((l: LayoutItem) => visibleWidgets.has(l.i)),
      md: (layouts.md || []).filter((l: LayoutItem) => visibleWidgets.has(l.i)),
      sm: (layouts.sm || []).filter((l: LayoutItem) => visibleWidgets.has(l.i)),
      xs: (layouts.xs || []).filter((l: LayoutItem) => visibleWidgets.has(l.i)),
    };
    return filtered;
  }, [layouts, visibleWidgets]);

  const lgLayout = visibleLayouts.lg || [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant={isLocked ? "default" : "outline"}
            size="sm"
            onClick={() => setIsLocked(!isLocked)}
            className="gap-2"
          >
            {isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            {isLocked ? t('common.locked') : t('common.unlocked')}
          </Button>
          
          {hasChanges && (
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={saveLayoutMutation.isPending}
            >
              {saveLayoutMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            {t('common.reset')}
          </Button>
          
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
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
                  Toggle widgets visibility. Drag widgets on the dashboard to reorder, resize by dragging corners.
                </DialogDescription>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto py-4 space-y-2">
                {Object.values(WIDGET_DEFINITIONS).map((def) => {
                  const Icon = def.icon;
                  return (
                    <div
                      key={def.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                    >
                      <Icon className="h-5 w-5 text-primary" />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{getWidgetName(def.id)}</p>
                        <p className="text-xs text-muted-foreground">{def.description}</p>
                      </div>
                      <Switch
                        checked={visibleWidgets.has(def.id)}
                        onCheckedChange={(checked) => handleToggleWidget(def.id, checked)}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end pt-4 border-t">
                <Button onClick={() => setSettingsOpen(false)}>
                  {t('common.close')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Grid Layout */}
      <div 
        className="relative"
        ref={(el) => {
          if (el) {
            const width = el.getBoundingClientRect().width;
            if (width !== containerWidth) {
              setContainerWidth(width);
            }
          }
        }}
      >
        <Responsive<string>
          className="layout"
          layouts={visibleLayouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
          cols={{ lg: 4, md: 3, sm: 2, xs: 1 }}
          rowHeight={150}
          width={containerWidth}
          onLayoutChange={handleLayoutChange}
          dragConfig={{ enabled: !isLocked, handle: '.widget-drag-handle' }}
          resizeConfig={{ enabled: !isLocked }}
          margin={[16, 16] as const}
          containerPadding={[0, 0] as const}
        >
          {lgLayout.map((item: LayoutItem) => {
            const def = WIDGET_DEFINITIONS[item.i];
            if (!def) return null;
            const Icon = def.icon;
            
            return (
              <div key={item.i} className="bg-card rounded-lg border shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                  <div className="flex items-center gap-2">
                    {!isLocked && (
                      <div className="widget-drag-handle cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                        <GripVertical className="h-4 w-4" />
                      </div>
                    )}
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">{getWidgetName(item.i)}</span>
                  </div>
                  {!isLocked && (
                    <Maximize2 className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
                <div className="p-4 h-[calc(100%-40px)] overflow-auto">
                  {children(item.i)}
                </div>
              </div>
            );
          })}
        </Responsive>
      </div>
    </div>
  );
}
