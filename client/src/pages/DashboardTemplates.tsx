import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  templateToCustomDashboardWidgets,
  type TemplateLayoutItem,
} from "@/lib/dashboardTemplateApply";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { 
  LayoutTemplate, 
  Plus, 
  Trash2, 
  Eye, 
  Copy,
  BarChart3,
  PieChart,
  Activity,
  Gauge,
  TrendingUp,
  AlertTriangle
} from "lucide-react";

// Predefined system templates
const SYSTEM_TEMPLATES = [
  {
    id: "production-overview",
    name: "Production Overview",
    description: "Tổng quan sản xuất với biểu đồ sản lượng, yield rate, và trạng thái máy",
    descriptionKey: "dashboard.tplProductionOverviewDesc",
    templateType: "system" as const,
    icon: BarChart3,
    widgets: ["production-stats", "yield-chart", "machine-status", "hourly-trend"],
    layout: [
      { i: "production-stats", x: 0, y: 0, w: 6, h: 2 },
      { i: "yield-chart", x: 6, y: 0, w: 6, h: 2 },
      { i: "machine-status", x: 0, y: 2, w: 8, h: 3 },
      { i: "hourly-trend", x: 8, y: 2, w: 4, h: 3 },
    ],
    color: "bg-blue-500",
  },
  {
    id: "quality-control",
    name: "Quality Control",
    description: "Giám sát chất lượng với NG analysis, SPC charts, và defect tracking",
    descriptionKey: "dashboard.tplQualityControlDesc",
    templateType: "system" as const,
    icon: PieChart,
    widgets: ["ng-analysis", "spc-chart", "defect-pareto", "quality-trend"],
    layout: [
      { i: "ng-analysis", x: 0, y: 0, w: 4, h: 3 },
      { i: "spc-chart", x: 4, y: 0, w: 8, h: 3 },
      { i: "defect-pareto", x: 0, y: 3, w: 6, h: 3 },
      { i: "quality-trend", x: 6, y: 3, w: 6, h: 3 },
    ],
    color: "bg-green-500",
  },
  {
    id: "machine-health",
    name: "Machine Health",
    description: "Theo dõi sức khỏe máy với uptime, alerts, và maintenance schedule",
    descriptionKey: "dashboard.tplMachineHealthDesc",
    templateType: "system" as const,
    icon: Activity,
    widgets: ["machine-uptime", "alert-summary", "maintenance-calendar", "oee-gauge"],
    layout: [
      { i: "machine-uptime", x: 0, y: 0, w: 8, h: 2 },
      { i: "oee-gauge", x: 8, y: 0, w: 4, h: 2 },
      { i: "alert-summary", x: 0, y: 2, w: 6, h: 3 },
      { i: "maintenance-calendar", x: 6, y: 2, w: 6, h: 3 },
    ],
    color: "bg-orange-500",
  },
  {
    id: "executive-summary",
    name: "Executive Summary",
    description: "Báo cáo tổng hợp cho quản lý với KPIs, trends, và comparisons",
    descriptionKey: "dashboard.tplExecutiveSummaryDesc",
    templateType: "system" as const,
    icon: Gauge,
    widgets: ["kpi-cards", "factory-comparison", "monthly-trend", "top-issues"],
    layout: [
      { i: "kpi-cards", x: 0, y: 0, w: 12, h: 2 },
      { i: "factory-comparison", x: 0, y: 2, w: 6, h: 3 },
      { i: "monthly-trend", x: 6, y: 2, w: 6, h: 3 },
      { i: "top-issues", x: 0, y: 5, w: 12, h: 2 },
    ],
    color: "bg-purple-500",
  },
  {
    id: "realtime-monitoring",
    name: "Realtime Monitoring",
    description: "Giám sát thời gian thực với live data, alerts, và status updates",
    descriptionKey: "dashboard.tplRealtimeMonitoringDesc",
    templateType: "system" as const,
    icon: TrendingUp,
    widgets: ["live-production", "active-alerts", "machine-map", "recent-inspections"],
    layout: [
      { i: "live-production", x: 0, y: 0, w: 8, h: 3 },
      { i: "active-alerts", x: 8, y: 0, w: 4, h: 3 },
      { i: "machine-map", x: 0, y: 3, w: 6, h: 4 },
      { i: "recent-inspections", x: 6, y: 3, w: 6, h: 4 },
    ],
    color: "bg-red-500",
  },
  {
    id: "alert-management",
    name: "Alert Management",
    description: "Quản lý cảnh báo với alert history, rules, và notifications",
    descriptionKey: "dashboard.tplAlertManagementDesc",
    templateType: "system" as const,
    icon: AlertTriangle,
    widgets: ["alert-timeline", "alert-rules", "notification-stats", "escalation-matrix"],
    layout: [
      { i: "alert-timeline", x: 0, y: 0, w: 8, h: 3 },
      { i: "notification-stats", x: 8, y: 0, w: 4, h: 3 },
      { i: "alert-rules", x: 0, y: 3, w: 6, h: 3 },
      { i: "escalation-matrix", x: 6, y: 3, w: 6, h: 3 },
    ],
    color: "bg-yellow-500",
  },
];

export default function DashboardTemplates() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState({
    name: "",
    description: "",
    templateType: "shared" as "system" | "shared",
  });

  const { data: customTemplates, refetch } = trpc.dashboard.listTemplates.useQuery();

  // Apply = persist a real user custom dashboard built from the template.
  const createDashboardMutation = trpc.dashboardWidget.createCustomDashboard.useMutation({
    onSuccess: () => {
      utils.dashboardWidget.listCustomDashboards.invalidate();
      toast.success(t('dashboard.templateApplied'), {
        description: t('dashboard.customDashboard'),
        action: {
          label: t('common.view'),
          onClick: () => setLocation('/custom-dashboard'),
        },
      });
      setApplyingId(null);
    },
    onError: (error) => {
      toast.error(error.message);
      setApplyingId(null);
    },
  });

  const applyTemplate = (params: {
    key: string;
    name: string;
    description?: string;
    widgets?: string[];
    layout?: TemplateLayoutItem[];
  }) => {
    const widgetConfigs = templateToCustomDashboardWidgets({
      widgets: params.widgets,
      layout: params.layout,
    });
    setApplyingId(params.key);
    createDashboardMutation.mutate({
      name: params.name,
      description: params.description || undefined,
      widgets: widgetConfigs,
      gridCols: 4,
      isPublic: false,
    });
  };
  
  const createTemplateMutation = trpc.dashboard.createTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('dashboard.templateCreated'));
      setCreateDialogOpen(false);
      setNewTemplate({ name: "", description: "", templateType: "shared" });
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteTemplateMutation = trpc.dashboard.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('dashboard.templateDeleted'));
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleCreateTemplate = () => {
    if (!newTemplate.name.trim()) {
      toast.error(t('dashboard.enterTemplateName'));
      return;
    }
    
    createTemplateMutation.mutate({
      name: newTemplate.name,
      description: newTemplate.description || undefined,
      templateType: newTemplate.templateType,
      widgets: [],
      layout: [],
      isPublic: true,
    });
  };

  const handleApplySystemTemplate = (template: typeof SYSTEM_TEMPLATES[0]) => {
    applyTemplate({
      key: `system-${template.id}`,
      name: template.name,
      description: template.description,
      widgets: template.widgets,
      layout: template.layout,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <LayoutTemplate className="h-6 w-6" />
              Dashboard Templates
            </h1>
            <p className="text-muted-foreground mt-1">
              {t('dashboard.templatesDescription')}
            </p>
          </div>
          
          {isAdmin && (
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('dashboard.createTemplate')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('dashboard.createNewTemplate')}</DialogTitle>
                  <DialogDescription>
                    {t('dashboard.createTemplateDescription')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t('dashboard.templateName')}</Label>
                    <Input
                      id="name"
                      value={newTemplate.name}
                      onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                      placeholder="VD: Production Dashboard Q1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">{t('common.description')}</Label>
                    <Textarea
                      id="description"
                      value={newTemplate.description}
                      onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                      placeholder={t('dashboard.descriptionPlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type">{t('dashboard.templateType')}</Label>
                    <Select
                      value={newTemplate.templateType}
                      onValueChange={(value: "system" | "shared") => 
                        setNewTemplate({ ...newTemplate, templateType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="shared">Shared (Team)</SelectItem>
                        <SelectItem value="system">System (All Users)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={handleCreateTemplate} disabled={createTemplateMutation.isPending}>
                    {createTemplateMutation.isPending ? t('dashboard.creating') : t('dashboard.createTemplate')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* System Templates */}
        <div>
          <h2 className="text-lg font-semibold mb-4">System Templates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {SYSTEM_TEMPLATES.map((template) => {
              const Icon = template.icon;
              return (
                <Card key={template.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className={`p-2 rounded-lg ${template.color} text-white`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant="secondary">System</Badge>
                    </div>
                    <CardTitle className="text-lg mt-3">{template.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {t(template.descriptionKey)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                      <span>{template.widgets.length} widgets</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => toast.info(t('dashboard.applyTemplateHint', { name: template.name }))}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        {t('dashboard.preview')}
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleApplySystemTemplate(template)}
                        disabled={createDashboardMutation.isPending && applyingId === `system-${template.id}`}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        {t('dashboard.apply')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Custom Templates */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Custom Templates</h2>
          {customTemplates && customTemplates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customTemplates.map((template) => (
                <Card key={template.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="p-2 rounded-lg bg-gray-500 text-white">
                        <LayoutTemplate className="h-5 w-5" />
                      </div>
                      <Badge variant="outline">
                        {template.templateType === "system" ? "System" : "Shared"}
                      </Badge>
                    </div>
                    <CardTitle className="text-lg mt-3">{template.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {template.description || t('dashboard.noDescription')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                      <span>{template.widgets?.length || 0} widgets</span>
                      <span>•</span>
                      <span>{template.usageCount} {t('dashboard.timesUsed')}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => applyTemplate({
                          key: `custom-${template.id}`,
                          name: template.name,
                          description: template.description ?? undefined,
                          widgets: Array.isArray(template.widgets) ? (template.widgets as string[]) : [],
                          layout: Array.isArray((template as any).layout) ? (template as any).layout : undefined,
                        })}
                        disabled={createDashboardMutation.isPending && applyingId === `custom-${template.id}`}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        {t('dashboard.apply')}
                      </Button>
                      {isAdmin && (
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => deleteTemplateMutation.mutate({ id: template.id })}
                          disabled={deleteTemplateMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <LayoutTemplate className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {t('dashboard.noCustomTemplates')} {isAdmin && t('dashboard.createFirstTemplate')}
              </p>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
