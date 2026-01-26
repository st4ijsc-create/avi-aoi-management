import { useState } from "react";
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
  | 'target-progress';

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
    name: 'KPI Card',
    description: 'Hiển thị một chỉ số KPI với trend',
    icon: <TrendingUp className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'small',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'KPI' },
      { key: 'dataSource', label: 'Nguồn dữ liệu', type: 'select', options: [
        { value: 'yield_rate', label: 'Tỷ lệ Yield' },
        { value: 'ng_rate', label: 'Tỷ lệ NG' },
        { value: 'oee', label: 'OEE' },
        { value: 'inspection_count', label: 'Số lượng kiểm tra' },
        { value: 'machine_uptime', label: 'Uptime máy' },
      ]},
      { key: 'showTrend', label: 'Hiển thị trend', type: 'boolean', default: true },
      { key: 'color', label: 'Màu sắc', type: 'color', default: '#3b82f6' },
    ],
  },
  {
    type: 'bar-chart',
    name: 'Bar Chart',
    description: 'Biểu đồ cột so sánh dữ liệu',
    icon: <BarChart3 className="w-6 h-6" />,
    category: 'charts',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'Bar Chart' },
      { key: 'dataSource', label: 'Nguồn dữ liệu', type: 'select', options: [
        { value: 'ng_by_machine', label: 'NG theo máy' },
        { value: 'yield_by_product', label: 'Yield theo sản phẩm' },
        { value: 'inspection_by_line', label: 'Kiểm tra theo line' },
      ]},
      { key: 'orientation', label: 'Hướng', type: 'select', options: [
        { value: 'vertical', label: 'Dọc' },
        { value: 'horizontal', label: 'Ngang' },
      ]},
      { key: 'showLegend', label: 'Hiển thị legend', type: 'boolean', default: true },
    ],
  },
  {
    type: 'line-chart',
    name: 'Line Chart',
    description: 'Biểu đồ đường theo thời gian',
    icon: <LineChart className="w-6 h-6" />,
    category: 'charts',
    defaultSize: 'large',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'Trend Chart' },
      { key: 'dataSource', label: 'Nguồn dữ liệu', type: 'select', options: [
        { value: 'yield_trend', label: 'Xu hướng Yield' },
        { value: 'ng_trend', label: 'Xu hướng NG' },
        { value: 'oee_trend', label: 'Xu hướng OEE' },
        { value: 'inspection_trend', label: 'Xu hướng kiểm tra' },
      ]},
      { key: 'timeRange', label: 'Khoảng thời gian', type: 'select', options: [
        { value: '7d', label: '7 ngày' },
        { value: '30d', label: '30 ngày' },
        { value: '90d', label: '90 ngày' },
      ]},
      { key: 'showArea', label: 'Hiển thị area', type: 'boolean', default: false },
    ],
  },
  {
    type: 'pie-chart',
    name: 'Pie Chart',
    description: 'Biểu đồ tròn phân bố dữ liệu',
    icon: <PieChart className="w-6 h-6" />,
    category: 'charts',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'Distribution' },
      { key: 'dataSource', label: 'Nguồn dữ liệu', type: 'select', options: [
        { value: 'result_distribution', label: 'Phân bố kết quả' },
        { value: 'defect_distribution', label: 'Phân bố lỗi' },
        { value: 'machine_distribution', label: 'Phân bố theo máy' },
      ]},
      { key: 'showLabels', label: 'Hiển thị labels', type: 'boolean', default: true },
      { key: 'donut', label: 'Dạng donut', type: 'boolean', default: false },
    ],
  },
  {
    type: 'gauge',
    name: 'Gauge',
    description: 'Đồng hồ đo hiển thị giá trị',
    icon: <Gauge className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'small',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'Gauge' },
      { key: 'dataSource', label: 'Nguồn dữ liệu', type: 'select', options: [
        { value: 'current_yield', label: 'Yield hiện tại' },
        { value: 'current_oee', label: 'OEE hiện tại' },
        { value: 'machine_health', label: 'Sức khỏe máy' },
      ]},
      { key: 'min', label: 'Giá trị min', type: 'number', default: 0 },
      { key: 'max', label: 'Giá trị max', type: 'number', default: 100 },
      { key: 'thresholds', label: 'Ngưỡng cảnh báo', type: 'range', min: 0, max: 100 },
    ],
  },
  {
    type: 'table',
    name: 'Data Table',
    description: 'Bảng dữ liệu với sorting và filtering',
    icon: <Table2 className="w-6 h-6" />,
    category: 'data',
    defaultSize: 'large',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'Data Table' },
      { key: 'dataSource', label: 'Nguồn dữ liệu', type: 'select', options: [
        { value: 'recent_inspections', label: 'Kiểm tra gần đây' },
        { value: 'top_ng_points', label: 'Top điểm NG' },
        { value: 'machine_status', label: 'Trạng thái máy' },
      ]},
      { key: 'pageSize', label: 'Số dòng/trang', type: 'number', default: 10 },
      { key: 'showPagination', label: 'Hiển thị phân trang', type: 'boolean', default: true },
    ],
  },
  {
    type: 'alert-list',
    name: 'Alert List',
    description: 'Danh sách cảnh báo real-time',
    icon: <Bell className="w-6 h-6" />,
    category: 'data',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'Alerts' },
      { key: 'maxItems', label: 'Số items tối đa', type: 'number', default: 5 },
      { key: 'severity', label: 'Mức độ', type: 'select', options: [
        { value: 'all', label: 'Tất cả' },
        { value: 'critical', label: 'Critical' },
        { value: 'warning', label: 'Warning' },
        { value: 'info', label: 'Info' },
      ]},
      { key: 'autoRefresh', label: 'Tự động làm mới', type: 'boolean', default: true },
    ],
  },
  {
    type: 'activity-feed',
    name: 'Activity Feed',
    description: 'Feed hoạt động hệ thống',
    icon: <Activity className="w-6 h-6" />,
    category: 'data',
    defaultSize: 'medium',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'Activity' },
      { key: 'maxItems', label: 'Số items tối đa', type: 'number', default: 10 },
      { key: 'activityTypes', label: 'Loại hoạt động', type: 'select', options: [
        { value: 'all', label: 'Tất cả' },
        { value: 'inspections', label: 'Kiểm tra' },
        { value: 'alerts', label: 'Cảnh báo' },
        { value: 'system', label: 'Hệ thống' },
      ]},
    ],
  },
  {
    type: 'target-progress',
    name: 'Target Progress',
    description: 'Tiến độ đạt mục tiêu',
    icon: <Target className="w-6 h-6" />,
    category: 'metrics',
    defaultSize: 'small',
    configFields: [
      { key: 'title', label: 'Tiêu đề', type: 'text', default: 'Target' },
      { key: 'dataSource', label: 'Nguồn dữ liệu', type: 'select', options: [
        { value: 'daily_target', label: 'Mục tiêu ngày' },
        { value: 'weekly_target', label: 'Mục tiêu tuần' },
        { value: 'monthly_target', label: 'Mục tiêu tháng' },
      ]},
      { key: 'showPercentage', label: 'Hiển thị %', type: 'boolean', default: true },
    ],
  },
  {
    type: 'clock',
    name: 'Clock',
    description: 'Đồng hồ thời gian thực',
    icon: <Clock className="w-6 h-6" />,
    category: 'utility',
    defaultSize: 'small',
    configFields: [
      { key: 'format', label: 'Định dạng', type: 'select', options: [
        { value: '24h', label: '24 giờ' },
        { value: '12h', label: '12 giờ' },
      ]},
      { key: 'showDate', label: 'Hiển thị ngày', type: 'boolean', default: true },
      { key: 'showSeconds', label: 'Hiển thị giây', type: 'boolean', default: false },
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
  const [isOpen, setIsOpen] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<WidgetDefinition | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, any>>({});
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const categories = [
    { id: 'all', label: 'Tất cả' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'charts', label: 'Charts' },
    { id: 'data', label: 'Data' },
    { id: 'utility', label: 'Utility' },
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
              <SelectValue placeholder="Chọn..." />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
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
        Thêm Widget
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Widget Library</DialogTitle>
            <DialogDescription>
              Chọn widget để thêm vào dashboard
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
                          <h4 className="font-medium">{widget.name}</h4>
                          <p className="text-sm text-muted-foreground truncate">
                            {widget.description}
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
                  {selectedWidget ? `Cấu hình: ${selectedWidget.name}` : 'Chọn widget'}
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
                          {configValues.title || selectedWidget.name}
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
                          {field.label}
                          {field.type === 'boolean' && renderConfigField(field)}
                        </Label>
                        {field.type !== 'boolean' && renderConfigField(field)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Chọn một widget từ danh sách bên trái để cấu hình</p>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleAddWidget} disabled={!selectedWidget}>
              <Plus className="w-4 h-4 mr-2" />
              Thêm Widget
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
