import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
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
// doc 67 W8 (việc 5): export để CustomDashboardContent tái dùng làm empty-state
// quick-start (grid 6 template 1-click khi user chưa có dashboard nào).
export const SYSTEM_TEMPLATES = [
  {
    id: "production-overview",
    name: "Production Overview",
    description: "embTpl.tongQuanSanXuatVoi",
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
    description: "embTpl.giamSatChatLuongVoi",
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
    description: "embTpl.theoDoiSucKhoeMay",
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
    description: "embTpl.baoCaoTongHopCho",
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
    description: "embTpl.giamSatThoiGianThuc",
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
    description: "embTpl.quanLyCanhBaoVoi",
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

// doc 67 W8 (P3): `embedded` — khi render trong hub /dashboard-center, PageHeader
// của hub đã có tiêu đề + mô tả nên section con bỏ h2+description lặp (giữ nút hành động).
export default function EmbeddedDashboardTemplates({ embedded = false }: { embedded?: boolean } = {}) {
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

  // Apply = create a real user custom dashboard from the template's widgets.
  // This persists to userCustomDashboards, which CustomDashboardViewer renders
  // on the main Dashboard "custom" tab and /custom-dashboard.
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
      toastTrpcError(error);
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
      toastTrpcError(error);
    },
  });

  const deleteTemplateMutation = trpc.dashboard.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('dashboard.templateDeleted'));
      refetch();
    },
    onError: (error) => {
      toastTrpcError(error);
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
    <div className="space-y-6">
      {/* Header — embedded (doc 67 W8 P3): bỏ h2+description lặp với PageHeader hub */}
      <div className={embedded ? "flex items-center justify-end" : "flex items-center justify-between"}>
        {!embedded && (
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5" />
              Dashboard Templates
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('dashboard.selectOrCreateTemplate')}
            </p>
          </div>
        )}
        {isAdmin && (
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t('dashboard.createTemplate')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('dashboard.createCustomTemplate')}</DialogTitle>
                <DialogDescription>
                  {t('dashboard.createCustomTemplateDesc')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="template-name">{t('dashboard.templateName')}</Label>
                  <Input
                    id="template-name"
                    placeholder={t('dashboard.enterTemplateName')}
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="template-desc">{t('common.description')}</Label>
                  <Textarea
                    id="template-desc"
                    placeholder={t('dashboard.templateDescPlaceholder')}
                    value={newTemplate.description}
                    onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleCreateTemplate} disabled={createTemplateMutation.isPending}>
                  {createTemplateMutation.isPending ? t('common.creating') : t('dashboard.createTemplate')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* System Templates */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-3">System Templates</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t('dashboard.systemTemplatesDesc')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SYSTEM_TEMPLATES.map((template) => {
            const Icon = template.icon;
            return (
              <Card key={template.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className={`p-2 rounded-lg ${template.color} bg-opacity-10`}>
                      <Icon className={`h-5 w-5 ${template.color.replace('bg-', 'text-')}`} />
                    </div>
                    <Badge variant="secondary" className="text-xs">System</Badge>
                  </div>
                  <CardTitle className="text-base mt-2">{t(template.name)}</CardTitle>
                  <CardDescription className="text-xs">{t(template.description)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant="outline" className="text-xs">{template.widgets.length} widgets</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleApplySystemTemplate(template)}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      {t('common.preview')}
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleApplySystemTemplate(template)}
                      disabled={createDashboardMutation.isPending && applyingId === `system-${template.id}`}
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      {t('common.apply')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Custom Templates */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-3">Custom Templates</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t('dashboard.customTemplatesDesc')}
          </p>
        </div>
        {!customTemplates || customTemplates.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <LayoutTemplate className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground text-center">
                {t('dashboard.noCustomTemplates')} {isAdmin && t('dashboard.createFirstTemplate')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customTemplates.map((template: any) => (
              <Card key={template.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-lg bg-primary bg-opacity-10">
                      <LayoutTemplate className="h-5 w-5 text-primary" />
                    </div>
                    <Badge variant="default" className="text-xs">Custom</Badge>
                  </div>
                  <CardTitle className="text-base mt-2">{t(template.name)}</CardTitle>
                  <CardDescription className="text-xs">{t(template.description)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant="outline" className="text-xs">
                      {template.widgets?.length || 0} widgets
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      {t('common.preview')}
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => applyTemplate({
                        key: `custom-${template.id}`,
                        name: template.name,
                        description: template.description,
                        widgets: Array.isArray(template.widgets) ? template.widgets : [],
                        layout: Array.isArray(template.layout) ? template.layout : undefined,
                      })}
                      disabled={createDashboardMutation.isPending && applyingId === `custom-${template.id}`}
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      {t('common.apply')}
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteTemplateMutation.mutate({ id: template.id })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
