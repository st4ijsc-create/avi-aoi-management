import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
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
      // Lưu MÔ TẢ ĐÃ DỊCH: bảng người dùng tạo ra phải mang ngôn ngữ họ đang dùng.
      description: t(template.descriptionKey),
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

        {/* W5-C (doc 27 A12): role → default dashboard binding (admin only) */}
        {isAdmin && <RoleDefaultsSection />}
      </div>
    </DashboardLayout>
  );
}

// ─── Role → default dashboard (doc 27 A12 / W5-C) ────────────────────────────
// Admin-only. Binds each role to a shared template OR a public custom dashboard
// (mutually exclusive) plus an optional landing path override. Resolution for
// users happens in dashboardWidget.getMyEffectiveDashboard — personal
// dashboards always win, so a binding only affects users who own none.

const ROLE_OPTIONS = [
  "admin",
  "supervisor",
  "quality_inspector",
  "operator",
  "maintenance",
  "viewer",
  "user",
] as const;

function RoleDefaultsSection() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  const defaultsQuery = trpc.dashboardWidget.listRoleDefaults.useQuery();
  const templatesQuery = trpc.dashboard.listTemplates.useQuery();
  const publicDashboardsQuery = trpc.dashboardWidget.listPublicDashboards.useQuery();

  const setMutation = trpc.dashboardWidget.setRoleDefault.useMutation({
    onSuccess: () => {
      utils.dashboardWidget.listRoleDefaults.invalidate();
      toast.success(t('dashboard.roleDefaultSaved', 'Đã lưu mặc định vai trò'));
    },
    onError: (e) => toastTrpcError(e),
  });
  const clearMutation = trpc.dashboardWidget.clearRoleDefault.useMutation({
    onSuccess: () => {
      utils.dashboardWidget.listRoleDefaults.invalidate();
      toast.success(t('dashboard.roleDefaultCleared', 'Đã xóa mặc định vai trò'));
    },
    onError: (e) => toastTrpcError(e),
  });

  const bindings = defaultsQuery.data || [];
  const bindingByRole = new Map(bindings.map((b: any) => [b.role, b]));

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">
          {t('dashboard.roleDefaultsTitle', 'Dashboard mặc định theo vai trò')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'dashboard.roleDefaultsDesc',
            'Người dùng CHƯA có dashboard cá nhân sẽ nhận layout này theo vai trò (dashboard cá nhân luôn được ưu tiên). Landing path (tùy chọn) ghi đè trang đích khi vào "/".',
          )}
        </p>
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {ROLE_OPTIONS.map((role) => (
            <RoleDefaultRow
              key={`${role}:${(bindingByRole.get(role) as any)?.updatedAt ?? 'none'}`}
              role={role}
              binding={bindingByRole.get(role) as any}
              templates={(templatesQuery.data as any[]) || []}
              publicDashboards={(publicDashboardsQuery.data as any[]) || []}
              onSave={(input) => setMutation.mutate(input)}
              onClear={() => clearMutation.mutate({ role })}
              saving={setMutation.isPending || clearMutation.isPending}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RoleDefaultRow({
  role,
  binding,
  templates,
  publicDashboards,
  onSave,
  onClear,
  saving,
}: {
  role: string;
  binding?: { dashboardTemplateId: number | null; customDashboardId: number | null; landingPath: string | null } | null;
  templates: Array<{ id: number; name: string }>;
  publicDashboards: Array<{ id: number; name: string }>;
  onSave: (input: { role: string; dashboardTemplateId: number | null; customDashboardId: number | null; landingPath: string | null }) => void;
  onClear: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string>(() => {
    if (binding?.dashboardTemplateId != null) return `tpl:${binding.dashboardTemplateId}`;
    if (binding?.customDashboardId != null) return `dash:${binding.customDashboardId}`;
    return "none";
  });
  const [landingPath, setLandingPath] = useState<string>(binding?.landingPath ?? "");

  const handleSave = () => {
    const trimmed = landingPath.trim();
    if (trimmed && !trimmed.startsWith("/")) {
      toast.error(t('dashboard.roleDefaultLandingInvalid', 'Landing path phải bắt đầu bằng "/"'));
      return;
    }
    onSave({
      role,
      dashboardTemplateId: target.startsWith("tpl:") ? Number(target.slice(4)) : null,
      customDashboardId: target.startsWith("dash:") ? Number(target.slice(5)) : null,
      landingPath: trimmed || null,
    });
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center">
      <div className="w-40 shrink-0">
        <Badge variant="outline">{t(`roles.${role}`, role)}</Badge>
      </div>
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger className="w-full lg:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('dashboard.roleDefaultNone', '— Không đặt —')}</SelectItem>
          {templates.map((tp) => (
            <SelectItem key={`tpl-${tp.id}`} value={`tpl:${tp.id}`}>
              {t('dashboard.roleDefaultTemplatePrefix', 'Template')}: {tp.name}
            </SelectItem>
          ))}
          {publicDashboards.map((d) => (
            <SelectItem key={`dash-${d.id}`} value={`dash:${d.id}`}>
              {t('dashboard.roleDefaultDashboardPrefix', 'Dashboard công khai')}: {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={landingPath}
        onChange={(e) => setLandingPath(e.target.value)}
        placeholder={t('dashboard.roleDefaultLandingPlaceholder', 'Landing path (vd /andon) — tùy chọn')}
        className="w-full lg:w-64"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {t('common.save', 'Lưu')}
        </Button>
        {binding && (
          <Button size="sm" variant="outline" onClick={onClear} disabled={saving}>
            {t('common.clear', 'Xóa')}
          </Button>
        )}
      </div>
    </div>
  );
}
