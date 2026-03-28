import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { GridLayout, useContainerWidth, type Layout, type LayoutItem as RGLLayoutItem } from "react-grid-layout";

// Custom layout type compatible with react-grid-layout
interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  GripVertical, 
  RotateCcw, 
  Save, 
  Settings2, 
  Eye, 
  EyeOff,
  Lock,
  Unlock,
  LayoutGrid,
  Maximize2,
  Minimize2
} from "lucide-react";
import { toast } from "sonner";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// Using GridLayout directly with container width hook

// Widget definitions
export type WidgetId = 
  | "shift-stats" 
  | "top-machines" 
  | "worst-machines" 
  | "time-chart" 
  | "pie-chart" 
  | "bar-chart"
  | "top-workstations";

export interface WidgetConfig {
  id: WidgetId;
  title: string;
  description: string;
  defaultLayout: { x: number; y: number; w: number; h: number; minW?: number; minH?: number };
  visible: boolean;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { 
    id: "shift-stats", 
    title: "dashboard.widgets.shiftStats", 
    description: "dashboard.widgets.shiftStatsDesc",
    defaultLayout: { x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    visible: true 
  },
  { 
    id: "top-machines", 
    title: "dashboard.widgets.topMachines", 
    description: "dashboard.widgets.topMachinesDesc",
    defaultLayout: { x: 4, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    visible: true 
  },
  { 
    id: "worst-machines", 
    title: "dashboard.widgets.worstMachines", 
    description: "dashboard.widgets.worstMachinesDesc",
    defaultLayout: { x: 8, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    visible: true 
  },
  { 
    id: "time-chart", 
    title: "dashboard.widgets.timeChart", 
    description: "dashboard.widgets.timeChartDesc",
    defaultLayout: { x: 0, y: 4, w: 6, h: 5, minW: 4, minH: 4 },
    visible: true 
  },
  { 
    id: "pie-chart", 
    title: "dashboard.widgets.pieChart", 
    description: "dashboard.widgets.pieChartDesc",
    defaultLayout: { x: 6, y: 4, w: 3, h: 5, minW: 3, minH: 4 },
    visible: true 
  },
  { 
    id: "bar-chart", 
    title: "dashboard.widgets.barChart", 
    description: "dashboard.widgets.barChartDesc",
    defaultLayout: { x: 9, y: 4, w: 3, h: 5, minW: 3, minH: 4 },
    visible: true 
  },
  { 
    id: "top-workstations", 
    title: "dashboard.widgets.topWorkstations", 
    description: "dashboard.widgets.topWorkstationsDesc",
    defaultLayout: { x: 0, y: 9, w: 12, h: 4, minW: 6, minH: 3 },
    visible: true 
  },
];

const STORAGE_KEY = "dashboard-widget-layout";
const VISIBILITY_KEY = "dashboard-widget-visibility";

interface DraggableDashboardWidgetsProps {
  children: React.ReactNode;
  widgetIds: WidgetId[];
  renderWidget: (id: WidgetId) => React.ReactNode;
}

export function DraggableDashboardWidgets({ 
  children, 
  widgetIds, 
  renderWidget 
}: DraggableDashboardWidgetsProps) {
  const { t } = useTranslation();
  const [layouts, setLayouts] = useState<LayoutItem[]>([]);
  const [visibility, setVisibility] = useState<Record<WidgetId, boolean>>({} as Record<WidgetId, boolean>);
  const [isEditing, setIsEditing] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Load saved layout and visibility from localStorage
  useEffect(() => {
    try {
      const savedLayout = localStorage.getItem(STORAGE_KEY);
      const savedVisibility = localStorage.getItem(VISIBILITY_KEY);
      
      if (savedLayout) {
        setLayouts(JSON.parse(savedLayout));
      } else {
        // Use default layouts
        setLayouts(DEFAULT_WIDGETS.map(w => ({
          i: w.id,
          ...w.defaultLayout
        })));
      }
      
      if (savedVisibility) {
        setVisibility(JSON.parse(savedVisibility));
      } else {
        // All visible by default
        const defaultVisibility: Record<WidgetId, boolean> = {} as Record<WidgetId, boolean>;
        DEFAULT_WIDGETS.forEach(w => {
          defaultVisibility[w.id] = w.visible;
        });
        setVisibility(defaultVisibility);
      }
    } catch (e) {
      console.error("Error loading dashboard layout:", e);
    }
  }, []);

  // Save layout to localStorage
  const saveLayout = useCallback((newLayouts: LayoutItem[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayouts));
      setLayouts(newLayouts);
    } catch (e) {
      console.error("Error saving dashboard layout:", e);
    }
  }, []);

  // Save visibility to localStorage
  const saveVisibility = useCallback((newVisibility: Record<WidgetId, boolean>) => {
    try {
      localStorage.setItem(VISIBILITY_KEY, JSON.stringify(newVisibility));
      setVisibility(newVisibility);
    } catch (e) {
      console.error("Error saving widget visibility:", e);
    }
  }, []);

  // Handle layout change
  const handleLayoutChange = useCallback((newLayouts: LayoutItem[]) => {
    if (!isLocked) {
      saveLayout(newLayouts);
    }
  }, [isLocked, saveLayout]);

  // Toggle widget visibility
  const toggleWidgetVisibility = useCallback((widgetId: WidgetId) => {
    const newVisibility = {
      ...visibility,
      [widgetId]: !visibility[widgetId]
    };
    saveVisibility(newVisibility);
  }, [visibility, saveVisibility]);

  // Reset to default layout
  const resetLayout = useCallback(() => {
    const defaultLayouts = DEFAULT_WIDGETS.map(w => ({
      i: w.id as string,
      x: w.defaultLayout.x,
      y: w.defaultLayout.y,
      w: w.defaultLayout.w,
      h: w.defaultLayout.h,
      minW: w.defaultLayout.minW,
      minH: w.defaultLayout.minH
    })) as LayoutItem[];
    const defaultVisibility: Record<WidgetId, boolean> = {} as Record<WidgetId, boolean>;
    DEFAULT_WIDGETS.forEach(w => {
      defaultVisibility[w.id] = w.visible;
    });
    
    saveLayout(defaultLayouts);
    saveVisibility(defaultVisibility);
    toast.success(t('dashboard.layoutReset'));
  }, [saveLayout, saveVisibility]);

  // Filter visible widgets
  const visibleWidgets = useMemo(() => {
    return widgetIds.filter(id => visibility[id] !== false);
  }, [widgetIds, visibility]);

  // Get layout for visible widgets
  const visibleLayouts = useMemo(() => {
    return layouts.filter(l => visibleWidgets.includes(l.i as WidgetId));
  }, [layouts, visibleWidgets]);

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={isLocked ? "outline" : "default"}
            size="sm"
            onClick={() => setIsLocked(!isLocked)}
            className="gap-2"
          >
            {isLocked ? (
              <>
                <Lock className="h-4 w-4" />
                <span className="hidden sm:inline">{t('dashboard.locked')}</span>
              </>
            ) : (
              <>
                <Unlock className="h-4 w-4" />
                <span className="hidden sm:inline">{t('dashboard.editing')}</span>
              </>
            )}
          </Button>
          
          {!isLocked && (
            <Badge variant="secondary" className="animate-pulse">
              {t('dashboard.dragToArrange')}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Settings2 className="h-4 w-4" />
                <span className="hidden sm:inline">{t('dashboard.customize')}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t('dashboard.customizeWidgets')}</DialogTitle>
                <DialogDescription className="sr-only">{t('dashboard.customizeWidgets')}</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-4 pr-4">
                  {DEFAULT_WIDGETS.map(widget => (
                    <div 
                      key={widget.id} 
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{t(widget.title)}</span>
                          {visibility[widget.id] !== false ? (
                            <Eye className="h-4 w-4 text-success" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t(widget.description)}
                        </p>
                      </div>
                      <Switch
                        checked={visibility[widget.id] !== false}
                        onCheckedChange={() => toggleWidgetVisibility(widget.id)}
                      />
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={resetLayout}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {t('dashboard.resetDefault')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={resetLayout}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
        </div>
      </div>

      {/* Grid Layout */}
      <GridLayout
        className="layout"
        layout={visibleLayouts as RGLLayoutItem[]}
        width={1200}
        gridConfig={{
          cols: 12,
          rowHeight: 60,
          margin: [16, 16]
        }}
        dragConfig={{
          enabled: !isLocked,
          handle: ".drag-handle",
          bounded: false,
          threshold: 3
        }}
        resizeConfig={{
          enabled: !isLocked,
          handles: ['se']
        }}
        onLayoutChange={(layout) => handleLayoutChange(layout as LayoutItem[])}
      >
        {visibleWidgets.map(widgetId => {
          const widget = DEFAULT_WIDGETS.find(w => w.id === widgetId);
          return (
            <div key={widgetId} className="relative group">
              <Card className="h-full overflow-hidden">
                {!isLocked && (
                  <div className="drag-handle absolute top-2 left-2 z-10 cursor-move opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="p-1.5 rounded bg-muted/80 backdrop-blur-sm">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    {t(widget?.title || widgetId)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-[calc(100%-60px)] overflow-auto">
                  {renderWidget(widgetId)}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
}

// Export widget IDs for use in Dashboard
export const DASHBOARD_WIDGET_IDS: WidgetId[] = DEFAULT_WIDGETS.map(w => w.id);
