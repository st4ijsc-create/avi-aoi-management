import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Responsive, type LayoutItem, type ResponsiveLayouts, type Layout as GridLayout, type Breakpoint } from 'react-grid-layout';
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
  Minimize2,
  Lock,
  Unlock,
  RotateCcw,
  LayoutIcon,
  Download,
  FileImage,
  FileText,
  X,
  RefreshCw,
  Timer,
  Save,
  Trash2,
  Plus,
  Circle,
  Palette,
  type LucideIcon,
} from 'lucide-react';
import { useDashboardWidgetCache } from '@/hooks/useWidgetCache';
import { TemplatePreview, PRESET_TEMPLATES } from './TemplatePreview';
import { WidgetDataExport, DashboardDataExport, type WidgetData } from './WidgetDataExport';
import { 
  WidgetStyleEditor, 
  type WidgetStyle, 
  DEFAULT_WIDGET_STYLE,
  getWidgetStyle,
  setWidgetStyle,
  getWidgetCSSStyles,
  getWidgetHeaderColor,
  loadWidgetStyles,
} from './WidgetStyleEditor';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
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

interface WidgetCacheStatus {
  isStale: boolean;
  lastUpdated: number | null;
}

interface ResizableDashboardProps {
  children: (widgetId: string) => React.ReactNode;
  onRefreshWidget?: (widgetId: string) => Promise<void>;
  widgetCacheStatus?: Record<string, WidgetCacheStatus>;
  getWidgetData?: (widgetId: string) => Promise<WidgetData>;
  getAllWidgetsData?: () => Promise<WidgetData[]>;
}

type AutoRefreshInterval = 0 | 30 | 60 | 300; // 0 = off, seconds

interface CustomTemplate {
  id: string;
  name: string;
  widgets: string[];
  layout: LayoutItem[];
  createdAt: number;
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

export function ResizableDashboard({ children, onRefreshWidget, widgetCacheStatus, getWidgetData, getAllWidgetsData }: ResizableDashboardProps) {
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
  const [fullscreenWidget, setFullscreenWidget] = useState<string | null>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [refreshingWidgets, setRefreshingWidgets] = useState<Set<string>>(new Set());
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<AutoRefreshInterval>(() => {
    const saved = localStorage.getItem('dashboard-auto-refresh');
    return saved ? parseInt(saved) as AutoRefreshInterval : 0;
  });
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState(0);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(() => {
    const saved = localStorage.getItem('dashboard-custom-templates');
    return saved ? JSON.parse(saved) : [];
  });
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  
  // Widget styles state
  const [widgetStyles, setWidgetStyles] = useState<Record<string, WidgetStyle>>(() => loadWidgetStyles());
  const [styleEditorOpen, setStyleEditorOpen] = useState(false);
  const [editingWidgetStyle, setEditingWidgetStyle] = useState<string | null>(null);

  // Fetch saved layout
  const { data: savedLayout, refetch } = trpc.dashboardWidget.getLayout.useQuery(undefined, {
    enabled: !!user,
  });

  // Fetch shared templates from database
  const { data: sharedTemplates } = trpc.dashboardWidget.getSharedTemplates.useQuery(undefined, {
    enabled: !!user,
  });

  // Apply shared template mutation
  const applySharedTemplateMutation = trpc.dashboardWidget.applySharedTemplate.useMutation();

  // Save as shared template mutation (admin only)
  const saveAsSharedTemplateMutation = trpc.dashboardWidget.saveAsSharedTemplate.useMutation({
    onSuccess: () => {
      toast.success('Template saved and shared with team');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Delete shared template mutation (admin only)
  const deleteSharedTemplateMutation = trpc.dashboardWidget.deleteSharedTemplate.useMutation({
    onSuccess: () => {
      toast.success('Shared template deleted');
    },
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

  const handleLayoutChange = useCallback((currentLayout: GridLayout, allLayouts: ResponsiveLayouts) => {
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

  // Template definitions
  const TEMPLATES: Record<string, { widgets: string[], layout: (widgets: string[]) => LayoutItem[] }> = {
    compact: {
      widgets: ['kpiCards', 'trendChart', 'machineStatus', 'alerts'],
      layout: (widgets) => widgets.map((id, idx) => ({
        i: id,
        x: idx % 2 * 2,
        y: Math.floor(idx / 2) * 2,
        w: 2,
        h: 2,
        minW: WIDGET_DEFINITIONS[id]?.minW || 1,
        minH: WIDGET_DEFINITIONS[id]?.minH || 1,
      })),
    },
    wide: {
      widgets: ['kpiCards', 'trendChart', 'recentInspections', 'factoryStats'],
      layout: (widgets) => widgets.map((id, idx) => ({
        i: id,
        x: 0,
        y: idx * 2,
        w: 4,
        h: 2,
        minW: WIDGET_DEFINITIONS[id]?.minW || 1,
        minH: WIDGET_DEFINITIONS[id]?.minH || 1,
      })),
    },
    analytics: {
      widgets: ['kpiCards', 'trendChart', 'topMachines', 'factoryStats', 'shiftStats'],
      layout: (widgets) => [
        { i: 'kpiCards', x: 0, y: 0, w: 4, h: 1, minW: 2, minH: 1 },
        { i: 'trendChart', x: 0, y: 1, w: 2, h: 2, minW: 2, minH: 2 },
        { i: 'topMachines', x: 2, y: 1, w: 2, h: 2, minW: 1, minH: 2 },
        { i: 'factoryStats', x: 0, y: 3, w: 2, h: 2, minW: 2, minH: 2 },
        { i: 'shiftStats', x: 2, y: 3, w: 2, h: 2, minW: 1, minH: 1 },
      ],
    },
  };

  const applyTemplate = useCallback((templateName: string) => {
    const template = TEMPLATES[templateName];
    if (!template) return;
    
    const lgLayout = template.layout(template.widgets);
    const newLayouts: ResponsiveLayouts = {
      lg: lgLayout,
      md: lgLayout.map(item => ({ ...item, w: Math.min(item.w, 3), x: item.x % 3 })),
      sm: lgLayout.map(item => ({ ...item, w: 2, x: 0 })),
      xs: lgLayout.map(item => ({ ...item, w: 1, x: 0 })),
    };
    
    setLayouts(newLayouts);
    setVisibleWidgets(new Set(template.widgets));
    setHasChanges(true);
    toast.success(`Applied ${templateName} template`);
  }, []);

  const exportDashboard = useCallback(async (format: 'png' | 'pdf') => {
    const dashboardEl = document.getElementById('dashboard-grid');
    if (!dashboardEl) {
      toast.error('Dashboard not found');
      return;
    }
    
    toast.info(`Preparing ${format.toUpperCase()} export...`);
    
    try {
      // Dynamic import html2canvas
      const html2canvas = (await import('html2canvas')).default;
      const { resolveOklchColors } = await import('../lib/resolveOklchColors');
      const canvas = await html2canvas(dashboardEl, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        onclone: (_doc: Document, el: HTMLElement) => {
          resolveOklchColors(el.ownerDocument);
        },
      });
      
      if (format === 'png') {
        const link = document.createElement('a');
        link.download = `dashboard-${new Date().toISOString().split('T')[0]}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        toast.success('Dashboard exported as PNG');
      } else {
        // Dynamic import jspdf
        const { jsPDF } = await import('jspdf');
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
          orientation: 'landscape',
          unit: 'px',
          format: [canvas.width / 2, canvas.height / 2],
        });
        
        // Add header
        pdf.setFontSize(16);
        pdf.text('Dashboard Report', 20, 30);
        pdf.setFontSize(10);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, 20, 45);
        
        // Add dashboard image
        pdf.addImage(imgData, 'PNG', 0, 60, canvas.width / 2, canvas.height / 2);
        
        pdf.save(`dashboard-${new Date().toISOString().split('T')[0]}.pdf`);
        toast.success('Dashboard exported as PDF');
      }
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export dashboard');
    }
  }, []);

  const handleFullscreen = useCallback((widgetId: string) => {
    setFullscreenWidget(widgetId);
  }, []);

  const closeFullscreen = useCallback(() => {
    setFullscreenWidget(null);
  }, []);

  // Keyboard shortcut for closing fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreenWidget) {
        closeFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreenWidget, closeFullscreen]);

  // Refresh widget handler
  const handleRefreshWidget = useCallback(async (widgetId: string) => {
    if (refreshingWidgets.has(widgetId)) return;
    
    setRefreshingWidgets(prev => new Set(prev).add(widgetId));
    
    try {
      if (onRefreshWidget) {
        await onRefreshWidget(widgetId);
      }
      toast.success(t('dashboard.widgetRefreshed', 'Widget refreshed'));
    } catch (error) {
      toast.error(t('dashboard.refreshFailed', 'Failed to refresh widget'));
    } finally {
      setTimeout(() => {
        setRefreshingWidgets(prev => {
          const next = new Set(prev);
          next.delete(widgetId);
          return next;
        });
      }, 500);
    }
  }, [refreshingWidgets, onRefreshWidget, t]);

  // Refresh all visible widgets
  const handleRefreshAll = useCallback(async () => {
    const widgetIds = Array.from(visibleWidgets);
    for (const widgetId of widgetIds) {
      await handleRefreshWidget(widgetId);
    }
  }, [visibleWidgets, handleRefreshWidget]);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefreshInterval === 0) {
      setAutoRefreshCountdown(0);
      return;
    }

    setAutoRefreshCountdown(autoRefreshInterval);
    
    const countdownInterval = setInterval(() => {
      setAutoRefreshCountdown(prev => {
        if (prev <= 1) {
          // Trigger refresh
          handleRefreshAll();
          return autoRefreshInterval;
        }
        return prev - 1;
      });
    }, 1000);

    // Pause when tab is not visible
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(countdownInterval);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(countdownInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoRefreshInterval, handleRefreshAll]);

  // Save auto-refresh preference
  const handleAutoRefreshChange = useCallback((interval: AutoRefreshInterval) => {
    setAutoRefreshInterval(interval);
    localStorage.setItem('dashboard-auto-refresh', String(interval));
    if (interval > 0) {
      toast.success(t('dashboard.autoRefreshEnabled', `Auto-refresh: every ${interval}s`));
    } else {
      toast.info(t('dashboard.autoRefreshDisabled', 'Auto-refresh disabled'));
    }
  }, [t]);

  // Save custom template
  const handleSaveTemplate = useCallback(() => {
    if (!newTemplateName.trim()) {
      toast.error(t('dashboard.templateNameRequired', 'Template name is required'));
      return;
    }

    const newTemplate: CustomTemplate = {
      id: `custom-${Date.now()}`,
      name: newTemplateName.trim(),
      widgets: Array.from(visibleWidgets),
      layout: (layouts.lg || []).map(item => ({ ...item })),
      createdAt: Date.now(),
    };

    const updated = [...customTemplates, newTemplate];
    setCustomTemplates(updated);
    localStorage.setItem('dashboard-custom-templates', JSON.stringify(updated));
    
    setNewTemplateName('');
    setSaveTemplateOpen(false);
    toast.success(t('dashboard.templateSaved', `Template "${newTemplate.name}" saved`));
  }, [newTemplateName, visibleWidgets, layouts, customTemplates, t]);

  // Delete custom template
  const handleDeleteTemplate = useCallback((templateId: string) => {
    const updated = customTemplates.filter(t => t.id !== templateId);
    setCustomTemplates(updated);
    localStorage.setItem('dashboard-custom-templates', JSON.stringify(updated));
    toast.success(t('dashboard.templateDeleted', 'Template deleted'));
  }, [customTemplates, t]);

  // Apply custom template
  const handleApplyCustomTemplate = useCallback((template: CustomTemplate) => {
    setVisibleWidgets(new Set(template.widgets));
    setLayouts(prev => ({
      ...prev,
      lg: template.layout,
    }));
    setHasChanges(true);
    toast.success(t('dashboard.templateApplied', `Template "${template.name}" applied`));
  }, [t]);

  // Apply shared template from database
  const handleApplySharedTemplate = useCallback((template: NonNullable<typeof sharedTemplates>[0]) => {
    setVisibleWidgets(new Set(template.widgets as string[]));
    setLayouts(prev => ({
      ...prev,
      lg: (template.layout as LayoutItem[]),
    }));
    setHasChanges(true);
    applySharedTemplateMutation.mutate({ id: template.id });
    toast.success(t('dashboard.templateApplied', `Template "${template.name}" applied`));
  }, [t, applySharedTemplateMutation]);

  // Save current layout as shared template (admin only)
  const handleSaveAsSharedTemplate = useCallback(() => {
    if (!newTemplateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }
    saveAsSharedTemplateMutation.mutate({
      name: newTemplateName.trim(),
      description: `Shared by ${user?.name || 'Admin'}`,
      isPublic: true,
    });
    setNewTemplateName('');
    setSaveTemplateOpen(false);
  }, [newTemplateName, user, saveAsSharedTemplateMutation]);

  // Delete shared template (admin only)
  const handleDeleteSharedTemplate = useCallback((id: number) => {
    deleteSharedTemplateMutation.mutate({ id });
  }, [deleteSharedTemplateMutation]);

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
          {/* Auto-refresh Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Timer className="h-4 w-4" />
                {autoRefreshInterval > 0 ? (
                  <span className="text-xs">
                    {autoRefreshCountdown}s
                  </span>
                ) : (
                  'Auto'
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Auto Refresh</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleAutoRefreshChange(0)}>
                <span className={autoRefreshInterval === 0 ? 'font-bold' : ''}>Off</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAutoRefreshChange(30)}>
                <span className={autoRefreshInterval === 30 ? 'font-bold' : ''}>Every 30 seconds</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAutoRefreshChange(60)}>
                <span className={autoRefreshInterval === 60 ? 'font-bold' : ''}>Every 1 minute</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAutoRefreshChange(300)}>
                <span className={autoRefreshInterval === 300 ? 'font-bold' : ''}>Every 5 minutes</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleRefreshAll}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Now
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Templates Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <LayoutIcon className="h-4 w-4" />
                Templates
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Preset Templates</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => applyTemplate('compact')} className="flex items-center gap-3 py-2">
                <TemplatePreview 
                  widgets={PRESET_TEMPLATES.compact.widgets} 
                  layout={PRESET_TEMPLATES.compact.layout} 
                  size="sm"
                />
                <div className="flex flex-col">
                  <span className="font-medium">Compact</span>
                  <span className="text-xs text-muted-foreground">Smaller widgets, more density</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyTemplate('wide')} className="flex items-center gap-3 py-2">
                <TemplatePreview 
                  widgets={PRESET_TEMPLATES.wide.widgets} 
                  layout={PRESET_TEMPLATES.wide.layout} 
                  size="sm"
                />
                <div className="flex flex-col">
                  <span className="font-medium">Wide</span>
                  <span className="text-xs text-muted-foreground">Full-width charts and tables</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyTemplate('analytics')} className="flex items-center gap-3 py-2">
                <TemplatePreview 
                  widgets={PRESET_TEMPLATES.analytics.widgets} 
                  layout={PRESET_TEMPLATES.analytics.layout} 
                  size="sm"
                />
                <div className="flex flex-col">
                  <span className="font-medium">Analytics</span>
                  <span className="text-xs text-muted-foreground">Focus on charts and trends</span>
                </div>
              </DropdownMenuItem>
              
              {/* Shared Templates from Database */}
              {sharedTemplates && sharedTemplates.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Shared Templates</DropdownMenuLabel>
                  {sharedTemplates.map(template => (
                    <DropdownMenuItem key={template.id} className="flex items-center gap-3 py-2">
                      <TemplatePreview 
                        widgets={template.widgets as string[]} 
                        layout={template.layout as { i: string; x: number; y: number; w: number; h: number }[]} 
                        size="sm"
                      />
                      <span onClick={() => handleApplySharedTemplate(template)} className="flex-1 cursor-pointer">
                        <div className="flex flex-col">
                          <span className="font-medium">{template.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {template.description || `Used ${template.usageCount} times`}
                          </span>
                        </div>
                      </span>
                      {user?.role === 'admin' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 ml-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSharedTemplate(template.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {/* Local Custom Templates */}
              {customTemplates.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>My Templates (Local)</DropdownMenuLabel>
                  {customTemplates.map(template => (
                    <DropdownMenuItem key={template.id} className="flex items-center gap-3 py-2">
                      <TemplatePreview 
                        widgets={template.widgets} 
                        layout={template.layout} 
                        size="sm"
                      />
                      <span onClick={() => handleApplyCustomTemplate(template)} className="flex-1 cursor-pointer">
                        <div className="flex flex-col">
                          <span className="font-medium">{template.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(template.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 ml-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTemplate(template.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSaveTemplateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Save as Local Template
              </DropdownMenuItem>
              {user?.role === 'admin' && (
                <DropdownMenuItem onClick={handleSaveAsSharedTemplate}>
                  <Save className="h-4 w-4 mr-2" />
                  Share with Team
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to Default
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export Dashboard</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exportDashboard('png')}>
                <FileImage className="h-4 w-4 mr-2" />
                Export as PNG (Screenshot)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportDashboard('pdf')}>
                <FileText className="h-4 w-4 mr-2" />
                Export as PDF (Screenshot)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* Export All Widgets Data */}
          {getAllWidgetsData && (
            <DashboardDataExport 
              getAllWidgetsData={getAllWidgetsData}
              dashboardTitle="AVI/AOI Dashboard"
            />
          )}
          
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
        id="dashboard-grid"
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
            
            // Get custom style for this widget
            const customStyle = widgetStyles[item.i];
            const hasCustomStyle = customStyle && customStyle.theme !== 'default';
            
            return (
              <div 
                key={item.i} 
                className={hasCustomStyle ? 'overflow-hidden' : 'bg-card rounded-lg border shadow-sm overflow-hidden'}
                style={hasCustomStyle ? getWidgetCSSStyles(customStyle) : undefined}
              >
                <div 
                  className="flex items-center justify-between px-4 py-2 border-b"
                  style={hasCustomStyle ? { 
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    borderColor: 'rgba(255,255,255,0.2)'
                  } : { backgroundColor: 'hsl(var(--muted) / 0.3)' }}
                >
                  <div className="flex items-center gap-2">
                    {!isLocked && (
                      <div className="widget-drag-handle cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                        <GripVertical className="h-4 w-4" />
                      </div>
                    )}
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">{getWidgetName(item.i)}</span>
                    {/* Cache status indicator */}
                    {widgetCacheStatus?.[item.i] && (
                      <div 
                        className="flex items-center gap-1 ml-2"
                        title={widgetCacheStatus[item.i].isStale 
                          ? 'Data is stale - click refresh' 
                          : `Last updated: ${widgetCacheStatus[item.i].lastUpdated 
                              ? new Date(widgetCacheStatus[item.i].lastUpdated!).toLocaleTimeString() 
                              : 'Never'}`
                        }
                      >
                        <Circle 
                          className={`h-2 w-2 ${widgetCacheStatus[item.i].isStale 
                            ? 'fill-yellow-500 text-yellow-500' 
                            : 'fill-green-500 text-green-500'}`} 
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleRefreshWidget(item.i)}
                      disabled={refreshingWidgets.has(item.i)}
                      title="Refresh widget"
                    >
                      <RefreshCw className={`h-3 w-3 ${refreshingWidgets.has(item.i) ? 'animate-spin' : ''}`} />
                    </Button>
                    {getWidgetData && (
                      <WidgetDataExport
                        widgetId={item.i}
                        widgetTitle={getWidgetName(item.i)}
                        getData={() => getWidgetData(item.i)}
                        size="sm"
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        setEditingWidgetStyle(item.i);
                        setStyleEditorOpen(true);
                      }}
                      title={t('dashboard.customizeStyle')}
                    >
                      <Palette className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleFullscreen(item.i)}
                      title="Fullscreen"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-4 h-[calc(100%-40px)] overflow-auto">
                  {children(item.i)}
                </div>
              </div>
            );
          })}
        </Responsive>
      </div>

      {/* Fullscreen Modal */}
      {fullscreenWidget && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="h-full flex flex-col">
            {/* Fullscreen Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-card">
              <div className="flex items-center gap-3">
                {(() => {
                  const def = WIDGET_DEFINITIONS[fullscreenWidget];
                  const Icon = def?.icon || Gauge;
                  return (
                    <>
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="font-semibold text-lg">{getWidgetName(fullscreenWidget)}</span>
                    </>
                  );
                })()}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeFullscreen}
                className="h-8 w-8"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            {/* Fullscreen Content */}
            <div className="flex-1 p-6 overflow-auto">
              <div className="h-full bg-card rounded-lg border p-6">
                {children(fullscreenWidget)}
              </div>
            </div>
            {/* Fullscreen Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t bg-card text-sm text-muted-foreground">
              <span>Press ESC to exit fullscreen</span>
              <Button
                variant="outline"
                size="sm"
                onClick={closeFullscreen}
                className="gap-2"
              >
                <Minimize2 className="h-4 w-4" />
                Exit Fullscreen
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Dialog */}
      <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Save your current dashboard layout as a custom template for quick access later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                placeholder="My Custom Layout"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveTemplate();
                  }
                }}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>This template will save:</p>
              <ul className="list-disc list-inside mt-1">
                <li>{visibleWidgets.size} visible widgets</li>
                <li>Current layout positions and sizes</li>
              </ul>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSaveTemplateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate} className="gap-2">
              <Save className="h-4 w-4" />
              Save Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Widget Style Editor Dialog */}
      {editingWidgetStyle && (
        <WidgetStyleEditor
          widgetId={editingWidgetStyle}
          widgetName={getWidgetName(editingWidgetStyle)}
          open={styleEditorOpen}
          onOpenChange={(open) => {
            setStyleEditorOpen(open);
            if (!open) setEditingWidgetStyle(null);
          }}
          currentStyle={widgetStyles[editingWidgetStyle] || DEFAULT_WIDGET_STYLE}
          onStyleChange={(style) => {
            setWidgetStyles(prev => {
              const newStyles = { ...prev, [editingWidgetStyle]: style };
              // Save to localStorage
              setWidgetStyle(editingWidgetStyle, style);
              return newStyles;
            });
          }}
        />
      )}
    </div>
  );
}
