import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import DashboardWidgetLibrary, { WidgetConfig, widgetDefinitions } from "./DashboardWidgetLibrary";
import DashboardWidgetRenderer from "./DashboardWidgetRenderer";
import { 
  GripVertical, 
  Settings, 
  Trash2, 
  Copy, 
  Maximize2, 
  Minimize2,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  LayoutGrid,
  Columns,
  Rows,
} from "lucide-react";

interface DashboardLayout {
  id: string;
  name: string;
  description?: string;
  widgets: WidgetConfig[];
  gridCols: number;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface DashboardLayoutEditorProps {
  layout: DashboardLayout;
  onSave: (layout: DashboardLayout) => void;
  onCancel: () => void;
}

export default function DashboardLayoutEditor({
  layout: initialLayout,
  onSave,
  onCancel,
}: DashboardLayoutEditorProps) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<DashboardLayout>(initialLayout);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const selectedWidget = layout.widgets.find(w => w.id === selectedWidgetId);

  const handleAddWidget = useCallback((widget: WidgetConfig) => {
    setLayout(prev => ({
      ...prev,
      widgets: [...prev.widgets, widget],
      updatedAt: new Date(),
    }));
    toast.success(t('dashboard.widgetAdded', { name: widget.title }));
  }, []);

  const handleRemoveWidget = useCallback((widgetId: string) => {
    setLayout(prev => ({
      ...prev,
      widgets: prev.widgets.filter(w => w.id !== widgetId),
      updatedAt: new Date(),
    }));
    setSelectedWidgetId(null);
    toast.success(t('dashboard.widgetDeleted'));
  }, []);

  const handleDuplicateWidget = useCallback((widgetId: string) => {
    const widget = layout.widgets.find(w => w.id === widgetId);
    if (!widget) return;

    const newWidget: WidgetConfig = {
      ...widget,
      id: `widget_${Date.now()}`,
      title: `${widget.title} (Copy)`,
      position: { x: widget.position.x, y: widget.position.y + 1 },
    };

    setLayout(prev => ({
      ...prev,
      widgets: [...prev.widgets, newWidget],
      updatedAt: new Date(),
    }));
    toast.success(t('dashboard.widgetDuplicated'));
  }, [layout.widgets]);

  const handleResizeWidget = useCallback((widgetId: string, size: 'small' | 'medium' | 'large' | 'full') => {
    setLayout(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => 
        w.id === widgetId ? { ...w, size } : w
      ),
      updatedAt: new Date(),
    }));
  }, []);

  const handleMoveWidget = useCallback((widgetId: string, direction: 'up' | 'down') => {
    setLayout(prev => {
      const widgets = [...prev.widgets];
      const index = widgets.findIndex(w => w.id === widgetId);
      if (index === -1) return prev;

      if (direction === 'up' && index > 0) {
        [widgets[index], widgets[index - 1]] = [widgets[index - 1], widgets[index]];
      } else if (direction === 'down' && index < widgets.length - 1) {
        [widgets[index], widgets[index + 1]] = [widgets[index + 1], widgets[index]];
      }

      return { ...prev, widgets, updatedAt: new Date() };
    });
  }, []);

  const handleUpdateWidgetConfig = useCallback((widgetId: string, config: Record<string, any>) => {
    setLayout(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => 
        w.id === widgetId ? { ...w, config: { ...w.config, ...config } } : w
      ),
      updatedAt: new Date(),
    }));
  }, []);

  const handleSave = () => {
    onSave(layout);
    toast.success(t('dashboard.layoutSaved'));
  };

  const handleReset = () => {
    setLayout(initialLayout);
    toast.info(t('dashboard.layoutReset'));
  };

  const getWidgetIcon = (type: string) => {
    const def = widgetDefinitions.find(w => w.type === type);
    return def?.icon || <LayoutGrid className="w-4 h-4" />;
  };

  const getSizeClass = (size: string) => {
    switch (size) {
      case 'small': return 'col-span-1';
      case 'medium': return 'col-span-2';
      case 'large': return 'col-span-3';
      case 'full': return 'col-span-4';
      default: return 'col-span-1';
    }
  };

  const getSizeLabel = (size: string) => {
    switch (size) {
      case 'small': return t('dashboard.columns', { count: 1 });
      case 'medium': return t('dashboard.columns', { count: 2 });
      case 'large': return t('dashboard.columns', { count: 3 });
      case 'full': return t('dashboard.columns', { count: 4 });
      default: return size;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="border-b p-3 flex items-center justify-between bg-background">
        <div className="flex items-center gap-4">
          <div>
            <Input
              value={layout.name}
              onChange={(e) => setLayout(prev => ({ ...prev, name: e.target.value }))}
              className="font-semibold text-lg border-none p-0 h-auto focus-visible:ring-0"
              placeholder={t('dashboard.layoutNamePlaceholder')}
            />
          </div>
          <Badge variant="outline">
            {layout.widgets.length} widgets
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            title={isPreviewMode ? t('dashboard.disablePreview') : t('dashboard.enablePreview')}
          >
            {isPreviewMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsLocked(!isLocked)}
            title={isLocked ? t('dashboard.unlock') : t('dashboard.lockLayout')}
          >
            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </Button>
          <Select 
            value={layout.gridCols.toString()} 
            onValueChange={(v) => setLayout(prev => ({ ...prev, gridCols: Number(v) }))}
          >
            <SelectTrigger className="w-[120px]">
              <Columns className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">{t('dashboard.columns', { count: 2 })}</SelectItem>
              <SelectItem value="3">{t('dashboard.columns', { count: 3 })}</SelectItem>
              <SelectItem value="4">{t('dashboard.columns', { count: 4 })}</SelectItem>
              <SelectItem value="6">{t('dashboard.columns', { count: 6 })}</SelectItem>
            </SelectContent>
          </Select>

          <div className="border-l pl-2 ml-2 flex gap-2">
            <DashboardWidgetLibrary 
              onAddWidget={handleAddWidget}
              existingWidgets={layout.widgets}
            />
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave}>
              <Save className="w-4 h-4 mr-2" />
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 overflow-auto p-4 bg-muted/30">
          {layout.widgets.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <LayoutGrid className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-medium mb-2">{t('dashboard.noWidgets')}</h3>
                <p className="text-muted-foreground mb-4">
                  {t('dashboard.addWidgetsToStart')}
                </p>
                <DashboardWidgetLibrary 
                  onAddWidget={handleAddWidget}
                  existingWidgets={layout.widgets}
                />
              </div>
            </div>
          ) : (
            <div 
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${layout.gridCols}, minmax(0, 1fr))` }}
            >
              {layout.widgets.map((widget, index) => (
                <Card
                  key={widget.id}
                  className={`${getSizeClass(widget.size)} transition-all ${
                    selectedWidgetId === widget.id ? 'ring-2 ring-primary' : ''
                  } ${isPreviewMode ? '' : 'cursor-pointer hover:shadow-md'}`}
                  onClick={() => !isPreviewMode && !isLocked && setSelectedWidgetId(widget.id)}
                >
                  {!isPreviewMode && !isLocked && (
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWidgetId(widget.id);
                          setIsConfigOpen(true);
                        }}
                      >
                        <Settings className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                  <CardHeader className="pb-2 flex flex-row items-center gap-2">
                    {!isPreviewMode && !isLocked && (
                      <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                    )}
                    <div className="p-1.5 bg-primary/10 rounded text-primary">
                      {getWidgetIcon(widget.type)}
                    </div>
                    <CardTitle className="text-sm font-medium flex-1">
                      {widget.title}
                    </CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {getSizeLabel(widget.size)}
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    {isPreviewMode ? (
                      <div className="h-32">
                        <DashboardWidgetRenderer
                          type={widget.type}
                          config={widget.config}
                          size={widget.size}
                        />
                      </div>
                    ) : (
                      <div className="h-24 bg-muted/50 rounded flex items-center justify-center text-muted-foreground text-sm">
                        {widget.type} preview
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Properties Panel */}
        {!isPreviewMode && selectedWidget && (
          <div className="w-80 border-l bg-background overflow-hidden flex flex-col">
            <div className="p-3 border-b flex items-center justify-between">
              <h3 className="font-medium">Properties</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedWidgetId(null)}
              >
                ×
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {/* Widget Info */}
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <div className="p-2 bg-primary/10 rounded text-primary">
                    {getWidgetIcon(selectedWidget.type)}
                  </div>
                  <div>
                    <p className="font-medium">{selectedWidget.title}</p>
                    <p className="text-xs text-muted-foreground">{selectedWidget.type}</p>
                  </div>
                </div>

                {/* Title */}
                <div className="space-y-2">
                  <Label>{t('common.title')}</Label>
                  <Input
                    value={selectedWidget.title}
                    onChange={(e) => {
                      setLayout(prev => ({
                        ...prev,
                        widgets: prev.widgets.map(w => 
                          w.id === selectedWidget.id ? { ...w, title: e.target.value } : w
                        ),
                      }));
                    }}
                  />
                </div>

                {/* Size */}
                <div className="space-y-2">
                  <Label>{t('dashboard.size')}</Label>
                  <div className="grid grid-cols-4 gap-1">
                    {(['small', 'medium', 'large', 'full'] as const).map(size => (
                      <Button
                        key={size}
                        variant={selectedWidget.size === size ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleResizeWidget(selectedWidget.id, size)}
                      >
                        {size === 'small' ? '1' : size === 'medium' ? '2' : size === 'large' ? '3' : '4'}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Position */}
                <div className="space-y-2">
                  <Label>{t('dashboard.position')}</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleMoveWidget(selectedWidget.id, 'up')}
                    >
                      {t('dashboard.moveUp')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleMoveWidget(selectedWidget.id, 'down')}
                    >
                      {t('dashboard.moveDown')}
                    </Button>
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <Label>Actions</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleDuplicateWidget(selectedWidget.id)}
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-destructive"
                      onClick={() => handleRemoveWidget(selectedWidget.id)}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>

                {/* Widget Config */}
                <div className="space-y-2">
                  <Label>{t('dashboard.widgetConfig')}</Label>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setIsConfigOpen(true)}
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    {t('dashboard.openConfig')}
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Widget Config Dialog */}
      <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.widgetConfig')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.customizeWidgetSettings')}
            </DialogDescription>
          </DialogHeader>
          {selectedWidget && (
            <div className="space-y-4">
              {Object.entries(selectedWidget.config).map(([key, value]) => (
                <div key={key} className="space-y-2">
                  <Label className="capitalize">{key.replace(/_/g, ' ')}</Label>
                  <Input
                    value={String(value)}
                    onChange={(e) => handleUpdateWidgetConfig(selectedWidget.id, { [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsConfigOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { DashboardLayout };
