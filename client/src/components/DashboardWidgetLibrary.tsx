import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { 
  BarChart3, 
  LineChart, 
  PieChart, 
  Gauge, 
  Table2, 
  Map, 
  Bell, 
  Activity,
  TrendingUp,
  Clock,
  Target,
  Zap,
  Plus,
  Settings,
  Eye,
  Trash2,
  Copy,
  GripVertical,
} from "lucide-react";

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  size: 'small' | 'medium' | 'large' | 'full';
  position: { x: number; y: number };
  config: Record<string, any>;
}

export type WidgetType = 
  | 'kpi-card'
  | 'bar-chart'
  | 'line-chart'
  | 'pie-chart'
  | 'gauge'
  | 'table'
  | 'map'
  | 'alert-list'
  | 'activity-feed'
  | 'trend-indicator'
  | 'clock'
  | 'target-progress'
  | 'production-volume'
  | 'machine-status'
  | 'top-ng-points'
  | 'throughput'
  | 'yield-rate'
  | 'recent-alerts';

interface WidgetDefinition {
  type: WidgetType;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'metrics' | 'charts' | 'data' | 'utility';
  defaultSize: 'small' | 'medium' | 'large';
  configFields: ConfigField[];
}

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'color' | 'range';
  options?: { value: string; label: string }[];
  default?: any;
  min?: number;
  max?: number;
}

const widgetDefinitions: WidgetDefinition[] = [
  {
    type: 'kpi-card',
    name: 'widgets.kpiCard.name',
    description: 'widgets.kpiCard.description',
    icon: <TrendingUp className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'small',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'KPI' },
      { key: 'dataSource', label: 'widgets.fields.dataSource', type: 'select', options: [
        { value: 'yield_rate', label: 'widgets.options.yieldRate' },
        { value: 'ng_rate', label: 'widgets.options.ngRate' },
        { value: 'oee', label: 'widgets.options.oee' },
        { value: 'inspection_count', label: 'widgets.options.inspectionCount' },
        { value: 'machine_uptime', label: 'widgets.options.machineUptime' },
      ]},
      { key: 'showTrend', label: 'widgets.fields.showTrend', type: 'boolean', default: true },
      { key: 'color', label: 'widgets.fields.color', type: 'color', default: '#3b82f6' },
    ],
  },
  {
    type: 'bar-chart',
    name: 'widgets.barChart.name',
    description: 'widgets.barChart.description',
    icon: <BarChart3 className="w-6 h-6" />,
    category: 'charts',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Bar Chart' },
      { key: 'dataSource', label: 'widgets.fields.dataSource', type: 'select', options: [
        { value: 'ng_by_machine', label: 'widgets.options.ngByMachine' },
        { value: 'yield_by_product', label: 'widgets.options.yieldByProduct' },
        { value: 'inspection_by_line', label: 'widgets.options.inspectionByLine' },
      ]},
      { key: 'orientation', label: 'widgets.fields.orientation', type: 'select', options: [
        { value: 'vertical', label: 'widgets.options.vertical' },
        { value: 'horizontal', label: 'widgets.options.horizontal' },
      ]},
      { key: 'showLegend', label: 'widgets.fields.showLegend', type: 'boolean', default: true },
    ],
  },
  {
    type: 'line-chart',
    name: 'widgets.lineChart.name',
    description: 'widgets.lineChart.description',
    icon: <LineChart className="w-6 h-6" />,
    category: 'charts',
    defaultSize: 'large',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Trend Chart' },
      { key: 'dataSource', label: 'widgets.fields.dataSource', type: 'select', options: [
        { value: 'yield_trend', label: 'widgets.options.yieldTrend' },
        { value: 'ng_trend', label: 'widgets.options.ngTrend' },
        { value: 'oee_trend', label: 'widgets.options.oeeTrend' },
        { value: 'inspection_trend', label: 'widgets.options.inspectionTrend' },
      ]},
      { key: 'timeRange', label: 'widgets.fields.timeRange', type: 'select', options: [
        { value: '7d', label: 'common.7days' },
        { value: '30d', label: 'common.30days' },
        { value: '90d', label: 'common.90days' },
      ]},
      { key: 'showArea', label: 'widgets.fields.showArea', type: 'boolean', default: false },
    ],
  },
  {
    type: 'pie-chart',
    name: 'widgets.pieChart.name',
    description: 'widgets.pieChart.description',
    icon: <PieChart className="w-6 h-6" />,
    category: 'charts',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Distribution' },
      { key: 'dataSource', label: 'widgets.fields.dataSource', type: 'select', options: [
        { value: 'result_distribution', label: 'widgets.options.resultDistribution' },
        { value: 'defect_distribution', label: 'widgets.options.defectDistribution' },
        { value: 'machine_distribution', label: 'widgets.options.machineDistribution' },
      ]},
      { key: 'showLabels', label: 'widgets.fields.showLabels', type: 'boolean', default: true },
      { key: 'donut', label: 'widgets.fields.donut', type: 'boolean', default: false },
    ],
  },
  {
    type: 'gauge',
    name: 'widgets.gauge.name',
    description: 'widgets.gauge.description',
    icon: <Gauge className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'small',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Gauge' },
      { key: 'dataSource', label: 'widgets.fields.dataSource', type: 'select', options: [
        { value: 'current_yield', label: 'widgets.options.currentYield' },
        { value: 'current_oee', label: 'widgets.options.currentOee' },
        { value: 'machine_health', label: 'widgets.options.machineHealth' },
      ]},
      { key: 'min', label: 'widgets.fields.minValue', type: 'number', default: 0 },
      { key: 'max', label: 'widgets.fields.maxValue', type: 'number', default: 100 },
      { key: 'thresholds', label: 'widgets.fields.threshold', type: 'range', min: 0, max: 100 },
    ],
  },
  {
    type: 'table',
    name: 'widgets.dataTable.name',
    description: 'widgets.dataTable.description',
    icon: <Table2 className="w-6 h-6" />,
    category: 'data',
    defaultSize: 'large',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Data Table' },
      { key: 'dataSource', label: 'widgets.fields.dataSource', type: 'select', options: [
        { value: 'recent_inspections', label: 'widgets.options.recentInspections' },
        { value: 'top_ng_points', label: 'widgets.options.topNgPoints' },
        { value: 'machine_status', label: 'widgets.options.machineStatus' },
      ]},
      { key: 'pageSize', label: 'widgets.fields.pageSize', type: 'number', default: 10 },
      { key: 'showPagination', label: 'widgets.fields.showPagination', type: 'boolean', default: true },
    ],
  },
  {
    type: 'alert-list',
    name: 'widgets.alertList.name',
    description: 'widgets.alertList.description',
    icon: <Bell className="w-6 h-6" />,
    category: 'data',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Alerts' },
      { key: 'maxItems', label: 'widgets.fields.maxItems', type: 'number', default: 5 },
      { key: 'severity', label: 'widgets.fields.severity', type: 'select', options: [
        { value: 'all', label: 'common.all' },
        { value: 'critical', label: 'common.critical' },
        { value: 'warning', label: 'common.warning' },
        { value: 'info', label: 'common.info' },
      ]},
      { key: 'autoRefresh', label: 'widgets.fields.autoRefresh', type: 'boolean', default: true },
    ],
  },
  {
    type: 'activity-feed',
    name: 'widgets.activityFeed.name',
    description: 'widgets.activityFeed.description',
    icon: <Activity className="w-6 h-6" />,
    category: 'data',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Activity' },
      { key: 'maxItems', label: 'widgets.fields.maxItems', type: 'number', default: 10 },
      { key: 'activityTypes', label: 'widgets.fields.activityTypes', type: 'select', options: [
        { value: 'all', label: 'common.all' },
        { value: 'inspections', label: 'widgets.options.inspections' },
        { value: 'alerts', label: 'widgets.options.alerts' },
        { value: 'system', label: 'widgets.options.system' },
      ]},
    ],
  },
  {
    type: 'target-progress',
    name: 'widgets.targetProgress.name',
    description: 'widgets.targetProgress.description',
    icon: <Target className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'small',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Target' },
      { key: 'dataSource', label: 'widgets.fields.dataSource', type: 'select', options: [
        { value: 'daily_target', label: 'widgets.options.dailyTarget' },
        { value: 'weekly_target', label: 'widgets.options.weeklyTarget' },
        { value: 'monthly_target', label: 'widgets.options.monthlyTarget' },
      ]},
      { key: 'showPercentage', label: 'widgets.fields.showPercentage', type: 'boolean', default: true },
    ],
  },
  {
    type: 'clock',
    name: 'widgets.clock.name',
    description: 'widgets.clock.description',
    icon: <Clock className="w-6 h-6" />,
    category: 'utility',
    defaultSize: 'small',
    configFields: [
      { key: 'format', label: 'widgets.fields.format', type: 'select', options: [
        { value: '24h', label: 'widgets.options.24h' },
        { value: '12h', label: 'widgets.options.12h' },
      ]},
      { key: 'showDate', label: 'widgets.fields.showDate', type: 'boolean', default: true },
      { key: 'showSeconds', label: 'widgets.fields.showSeconds', type: 'boolean', default: false },
    ],
  },
  // ============ REQUIRED WIDGET TYPES ============
  {
    type: 'yield-rate',
    name: 'widgets.yieldRate.name',
    description: 'widgets.yieldRate.description',
    icon: <TrendingUp className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Yield Rate' },
      { key: 'timeRange', label: 'widgets.fields.timeRange', type: 'select', options: [
        { value: 'today', label: 'common.today' },
        { value: '7d', label: 'common.7days' },
        { value: '30d', label: 'common.30days' },
      ]},
      { key: 'showTrend', label: 'widgets.fields.showTrend', type: 'boolean', default: true },
      { key: 'targetYield', label: 'widgets.fields.targetYield', type: 'number', default: 95, min: 0, max: 100 },
      { key: 'color', label: 'widgets.fields.color', type: 'color', default: '#22c55e' },
    ],
  },
  {
    type: 'production-volume',
    name: 'widgets.productionVolume.name',
    description: 'widgets.productionVolume.description',
    icon: <BarChart3 className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'large',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Production Volume' },
      { key: 'timeRange', label: 'widgets.fields.timeRange', type: 'select', options: [
        { value: 'today', label: 'common.today' },
        { value: '7d', label: 'common.7days' },
        { value: '30d', label: 'common.30days' },
      ]},
      { key: 'groupBy', label: 'widgets.fields.groupBy', type: 'select', options: [
        { value: 'hour', label: 'common.hour' },
        { value: 'day', label: 'common.day' },
        { value: 'week', label: 'common.week' },
      ]},
      { key: 'showStacked', label: 'widgets.fields.showStacked', type: 'boolean', default: true },
      { key: 'showTotal', label: 'widgets.fields.showTotal', type: 'boolean', default: true },
    ],
  },
  {
    type: 'machine-status',
    name: 'widgets.machineStatus.name',
    description: 'widgets.machineStatus.description',
    icon: <Zap className="w-6 h-6" />,
    category: 'data',
    defaultSize: 'large',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Machine Status' },
      { key: 'displayMode', label: 'widgets.fields.displayMode', type: 'select', options: [
        { value: 'grid', label: 'widgets.options.grid' },
        { value: 'list', label: 'widgets.options.list' },
        { value: 'compact', label: 'widgets.options.compact' },
      ]},
      { key: 'showLastActive', label: 'widgets.fields.showTime', type: 'boolean', default: true },
      { key: 'autoRefresh', label: 'widgets.fields.autoRefresh', type: 'boolean', default: true },
    ],
  },
  {
    type: 'recent-alerts',
    name: 'widgets.recentAlerts.name',
    description: 'widgets.recentAlerts.description',
    icon: <Bell className="w-6 h-6" />,
    category: 'data',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Recent Alerts' },
      { key: 'maxItems', label: 'widgets.fields.maxItems', type: 'number', default: 10 },
      { key: 'severity', label: 'widgets.fields.severity', type: 'select', options: [
        { value: 'all', label: 'common.all' },
        { value: 'critical', label: 'common.critical' },
        { value: 'warning', label: 'common.warning' },
        { value: 'info', label: 'common.info' },
      ]},
      { key: 'showTimestamp', label: 'widgets.fields.showTime', type: 'boolean', default: true },
      { key: 'autoRefresh', label: 'widgets.fields.autoRefresh', type: 'boolean', default: true },
    ],
  },
  {
    type: 'top-ng-points',
    name: 'widgets.topNgPoints.name',
    description: 'widgets.topNgPoints.description',
    icon: <BarChart3 className="w-6 h-6" />,
    category: 'charts',
    defaultSize: 'large',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Top NG Points' },
      { key: 'topN', label: 'widgets.fields.topN', type: 'number', default: 10, min: 3, max: 50 },
      { key: 'timeRange', label: 'widgets.fields.timeRange', type: 'select', options: [
        { value: 'today', label: 'common.today' },
        { value: '7d', label: 'common.7days' },
        { value: '30d', label: 'common.30days' },
      ]},
      { key: 'showPareto', label: 'widgets.fields.paretoLine', type: 'boolean', default: true },
      { key: 'showPercentage', label: 'widgets.fields.showPercentage', type: 'boolean', default: true },
    ],
  },
  {
    type: 'throughput',
    name: 'widgets.throughput.name',
    description: 'widgets.throughput.description',
    icon: <Activity className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'widgets.fields.title', type: 'text', default: 'Throughput' },
      { key: 'timeRange', label: 'widgets.fields.timeRange', type: 'select', options: [
        { value: 'today', label: 'common.today' },
        { value: '7d', label: 'common.7days' },
        { value: '30d', label: 'common.30days' },
      ]},
      { key: 'unit', label: 'widgets.fields.unit', type: 'select', options: [
        { value: 'per_hour', label: 'widgets.options.perHour' },
        { value: 'per_shift', label: 'widgets.options.perShift' },
        { value: 'per_day', label: 'widgets.options.perDay' },
      ]},
      { key: 'showTarget', label: 'widgets.fields.showTarget', type: 'boolean', default: true },
      { key: 'targetValue', label: 'widgets.fields.targetValue', type: 'number', default: 1000 },
    ],
  },
];

interface DashboardWidgetLibraryProps {
  onAddWidget: (widget: WidgetConfig) => void;
  existingWidgets: WidgetConfig[];
}

export default function DashboardWidgetLibrary({ 
  onAddWidget, 
  existingWidgets 
}: DashboardWidgetLibraryProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<WidgetDefinition | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, any>>({});
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const categories = [
    { id: 'all', label: t('common.all') },
    { id: 'metrics', label: t('dashboard.categories.metrics') },
    { id: 'charts', label: t('dashboard.categories.charts') },
    { id: 'data', label: t('dashboard.categories.data') },
    { id: 'utility', label: t('dashboard.categories.utility') },
  ];

  const filteredWidgets = activeCategory === 'all' 
    ? widgetDefinitions 
    : widgetDefinitions.filter(w => w.category === activeCategory);

  const handleSelectWidget = (widget: WidgetDefinition) => {
    setSelectedWidget(widget);
    // Initialize config with defaults
    const defaults: Record<string, any> = {};
    widget.configFields.forEach(field => {
      defaults[field.key] = field.default ?? '';
    });
    setConfigValues(defaults);
  };

  const handleConfigChange = (key: string, value: any) => {
    setConfigValues(prev => ({ ...prev, [key]: value }));
  };

  const handleAddWidget = () => {
    if (!selectedWidget) return;

    const newWidget: WidgetConfig = {
      id: `widget_${Date.now()}`,
      type: selectedWidget.type,
      title: configValues.title || selectedWidget.name,
      size: selectedWidget.defaultSize,
      position: { x: 0, y: existingWidgets.length },
      config: configValues,
    };

    onAddWidget(newWidget);
    setIsOpen(false);
    setSelectedWidget(null);
    setConfigValues({});
  };

  const renderConfigField = (field: ConfigField) => {
    const value = configValues[field.key] ?? field.default;

    switch (field.type) {
      case 'text':
        return (
          <Input
            value={value || ''}
            onChange={(e) => handleConfigChange(field.key, e.target.value)}
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            value={value || ''}
            onChange={(e) => handleConfigChange(field.key, Number(e.target.value))}
            min={field.min}
            max={field.max}
          />
        );
      case 'select':
        return (
          <Select value={value || ''} onValueChange={(v) => handleConfigChange(field.key, v)}>
            <SelectTrigger>
              <SelectValue placeholder={t('common.select')} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'boolean':
        return (
          <Switch
            checked={value ?? false}
            onCheckedChange={(v) => handleConfigChange(field.key, v)}
          />
        );
      case 'color':
        return (
          <div className="flex gap-2">
            <Input
              type="color"
              value={value || '#3b82f6'}
              onChange={(e) => handleConfigChange(field.key, e.target.value)}
              className="w-12 h-10 p-1"
            />
            <Input
              value={value || '#3b82f6'}
              onChange={(e) => handleConfigChange(field.key, e.target.value)}
              className="flex-1"
            />
          </div>
        );
      case 'range':
        return (
          <Slider
            value={[value || 50]}
            onValueChange={(v) => handleConfigChange(field.key, v[0])}
            min={field.min || 0}
            max={field.max || 100}
            step={1}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>
        <Plus className="w-4 h-4 mr-2" />
        {t('dashboard.addWidget')}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t('dashboard.widgetLibrary')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.selectWidgetDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 h-[500px]">
            {/* Widget List */}
            <div className="border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted">
                <div className="flex gap-1 flex-wrap">
                  {categories.map(cat => (
                    <Button
                      key={cat.id}
                      variant={activeCategory === cat.id ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setActiveCategory(cat.id)}
                    >
                      {cat.label}
                    </Button>
                  ))}
                </div>
              </div>
              <ScrollArea className="h-[calc(100%-48px)]">
                <div className="p-2 space-y-2">
                  {filteredWidgets.map(widget => (
                    <Card
                      key={widget.type}
                      className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                        selectedWidget?.type === widget.type ? 'ring-2 ring-primary' : ''
                      }`}
                      onClick={() => handleSelectWidget(widget)}
                    >
                      <CardContent className="p-3 flex items-start gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg text-primary">
                          {widget.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium">{t(widget.name)}</h4>
                          <p className="text-sm text-muted-foreground truncate">
                            {t(widget.description)}
                          </p>
                          <Badge variant="outline" className="mt-1 text-xs">
                            {widget.category}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Configuration Panel */}
            <div className="border rounded-lg overflow-hidden">
              <div className="p-3 border-b bg-muted">
                <h3 className="font-medium">
                  {selectedWidget ? t('dashboard.configureWidget', { name: t(selectedWidget.name) }) : t('dashboard.selectWidget')}
                </h3>
              </div>
              <ScrollArea className="h-[calc(100%-48px)]">
                {selectedWidget ? (
                  <div className="p-4 space-y-4">
                    {/* Preview */}
                    <div className="p-4 border rounded-lg bg-muted/30 flex items-center justify-center">
                      <div className="text-center">
                        <div className="p-3 bg-primary/10 rounded-lg text-primary inline-block mb-2">
                          {selectedWidget.icon}
                        </div>
                        <p className="text-sm font-medium">
                          {configValues.title || t(selectedWidget.name)}
                        </p>
                        <Badge variant="secondary" className="mt-1">
                          {selectedWidget.defaultSize}
                        </Badge>
                      </div>
                    </div>

                    {/* Config Fields */}
                    {selectedWidget.configFields.map(field => (
                      <div key={field.key} className="space-y-2">
                        <Label className="flex items-center justify-between">
                          {t(field.label)}
                          {field.type === 'boolean' && renderConfigField(field)}
                        </Label>
                        {field.type !== 'boolean' && renderConfigField(field)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{t('dashboard.selectWidgetHint')}</p>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleAddWidget} disabled={!selectedWidget}>
              <Plus className="w-4 h-4 mr-2" />
              {t('dashboard.addWidget')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Export widget definitions for use in other components
export { widgetDefinitions };
export type { WidgetDefinition, ConfigField };
