import { usePermissions } from "@/_core/hooks/usePermissions";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, EmptyState } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";

import { 
  Plus,
  Loader2,
  Settings as SettingsIcon,
  Pencil,
  Trash2,
  MoreHorizontal,
  Bell,
  AlertTriangle,
  Target,
  ThumbsDown,
  ChevronDown,
  ChevronRight,
  Award,
  Mail,
  FileText,
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import YieldThresholdSettings from "@/components/YieldThresholdSettings";
import ScheduledReports from "@/components/ScheduledReports";
import ReportTemplates from "@/components/ReportTemplates";

import NotificationSoundCustomization from "@/components/NotificationSoundCustomization";

import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFormValidation, ValidationPatterns } from "@/hooks/useFormValidation";

import { ValidationMessage } from "@/components/ValidationMessage";
import { DeleteConfirmDialog } from "@/components/ConfirmDialog";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";

type AlertSetting = { 
  id: number; 
  userId: number; 
  name: string; 
  alertType: 'yield_rate' | 'ng_count' | 'machine_status' | 'machine_offline'; 
  threshold: string; 
  comparisonOperator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
  machineId?: number | null; 
  factoryId?: number | null; 
  isActive: boolean;
  notifyEmail: boolean;
  notifyInApp: boolean;
  cooldownMinutes: number;
};

export default function Settings() {
  const { t } = useTranslation();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const canView = hasPermission("settings_view", "canView");

  const search = useSearch();
  const [location, setLocation] = useLocation();
  
  // Parse tab from URL query parameter
  const getTabFromUrl = () => {
    const params = new URLSearchParams(search);
    return params.get('tab') || 'yield-thresholds';
  };
  
  const [activeTab, setActiveTab] = useState(getTabFromUrl);
  
  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setLocation(`/settings?tab=${tab}`);
  };
  
  // Sync tab with URL on mount and URL changes
  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [search]);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  
  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };
  
  // Alert Settings state
  const [alertForm, setAlertForm] = useState({
    name: "",
    alertType: "yield_rate" as 'yield_rate' | 'ng_count' | 'machine_status',
    threshold: "90",
    comparisonOperator: "lt" as 'lt' | 'lte' | 'gt' | 'gte' | 'eq',
    machineId: "all",
    factoryId: "all",
    notifyEmail: true,
    notifyInApp: true,
    cooldownMinutes: "60"
  });
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertSetting | null>(null);
  const [editAlertDialogOpen, setEditAlertDialogOpen] = useState(false);

  // Delete confirm dialog states
  const [deleteAlertDialogOpen, setDeleteAlertDialogOpen] = useState(false);
  const [alertToDelete, setAlertToDelete] = useState<AlertSetting | null>(null);

  // Alert form validation
  const alertValidation = useFormValidation<{
    name: string;
    threshold: string;
  }>({
    name: { required: true, minLength: 2, maxLength: 100 },
    threshold: { required: true, custom: (val) => {
      if (!val || isNaN(Number(val))) return t("validation.mustBeNumber");
      const num = Number(val);
      if (num < 0 || num > 100) return t("validation.valueRange0to100");
      return null;
    }},
  });

  // Queries
  const { data: alerts, refetch: refetchAlerts } = trpc.alert.list.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: factories } = trpc.factory.list.useQuery();

  // Alert Mutations
  const createAlertMutation = trpc.alert.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createAlertSuccess"));
      setAlertDialogOpen(false);
      setAlertForm({
        name: "",
        alertType: "yield_rate",
        threshold: "90",
        comparisonOperator: "lt",
        machineId: "",
        factoryId: "",
        notifyEmail: true,
        notifyInApp: true,
        cooldownMinutes: "60"
      });
      refetchAlerts();
    },
    onError: (err) => toastTrpcError(err),
  });

  const updateAlertMutation = trpc.alert.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateAlertSuccess"));
      setEditAlertDialogOpen(false);
      setEditingAlert(null);
      refetchAlerts();
    },
    onError: (err) => toastTrpcError(err),
  });

  const deleteAlertMutation = trpc.alert.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteAlertSuccess"));
      refetchAlerts();
    },
    onError: (err) => toastTrpcError(err),
  });

  if (permsLoading) {
    return (
      <DashboardLayout title={t("settings.title")} navItems={navItems} currentPath="/settings">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!canView) {
    return (
      <DashboardLayout title={t("settings.title")} navItems={navItems} currentPath="/settings">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <SettingsIcon className="h-16 w-16 text-muted-foreground/50" />
          <p className="text-xl font-medium text-foreground">{t("settings.adminOnlyAccess")}</p>
          <p className="text-muted-foreground">{t("settings.contactAdmin")}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("settings.title")} navItems={navItems} currentPath="/settings">
      <PageContainer>
        <PageHeader
          icon={<SettingsIcon className="h-6 w-6" />}
          title={t("settings.systemSettings")}
          description={t("settings.systemDescription")}
          badge={<ViewOnlyBadge module="settings_view" />}
        />

        <ErrorBoundary>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex gap-6">
            {/* Vertical Sidebar Navigation */}
            <div className="hidden" data-legacy-hub-menu="true">

              {/* Category: Chất lượng */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('quality')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-yellow-500" />
                    <span>{t("settings.cat.quality")}</span>
                  </div>
                  {collapsedCategories['quality'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['quality'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('yield-thresholds')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'yield-thresholds' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Target className="h-4 w-4" />
                      {t("settings.sidebar.yield")}
                    </button>
                    <button
                      onClick={() => handleTabChange('alerts')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'alerts' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Bell className="h-4 w-4" />
                      {t("settings.sidebar.alert")}
                    </button>
                  </div>
                )}
              </div>

              {/* Category: Báo cáo */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('reports')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-500" />
                    <span>{t("settings.cat.reports")}</span>
                  </div>
                  {collapsedCategories['reports'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['reports'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('report-templates')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'report-templates' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <FileText className="h-4 w-4" />
                      {t("settings.sidebar.reportTemplate")}
                    </button>
                    <button
                      onClick={() => handleTabChange('scheduled-reports')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'scheduled-reports' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Mail className="h-4 w-4" />
                      {t("settings.sidebar.scheduledReport")}
                    </button>
                  </div>
                )}
              </div>

              {/* Category: Thông báo */}
              <div className="space-y-1">
                <button
                  onClick={() => handleTabChange('notification-sounds')}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    activeTab === 'notification-sounds' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                  }`}
                >
                  <Bell className="h-4 w-4 text-pink-500" />
                  {t("settings.sidebar.notificationSounds", "Notification Sounds")}
                </button>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-w-0">

          {/* Notification Sounds Tab -- factories/workshops/lines/stations/machines/shifts/stages tabs moved to DataSettings */}
          <TabsContent value="notification-sounds">
            <NotificationSoundCustomization />
          </TabsContent>


          {/* Alerts Tab */}
          <TabsContent value="alerts">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bell className="h-5 w-5 text-primary" />{t("settings.alertThreshold")}</CardTitle>
                    <CardDescription>{t("settings.alertThresholdDesc")}</CardDescription>
                  </div>
                  <Dialog open={alertDialogOpen} onOpenChange={setAlertDialogOpen}>
                    <PermissionGate module="settings_view" action="canCreate">
                      <DialogTrigger asChild>
                        <Button className="gap-2">
                          <Plus className="h-4 w-4" />
                          {t("settings.addAlert")}
                        </Button>
                      </DialogTrigger>
                    </PermissionGate>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>{t("settings.createAlert")}</DialogTitle>
                        <DialogDescription>{t("settings.createAlertDesc")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.alertName")}<span className="text-destructive">*</span></label>
                          <Input
                            placeholder={t("settings.alertNamePlaceholder")}
                            value={alertForm.name}
                            onChange={(e) => setAlertForm({ ...alertForm, name: e.target.value })}
                            onBlur={() => alertValidation.handleBlur("name", alertForm.name)}
                            className={alertValidation.hasError("name") ? "border-destructive" : ""}
                          />
                          <ValidationMessage error={alertValidation.getFieldError("name")} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.metricType")} *</label>
                            <Select
                              value={alertForm.alertType}
                              onValueChange={(v) => setAlertForm({ ...alertForm, alertType: v as 'yield_rate' | 'ng_count' | 'machine_status' })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="yield_rate">{t("settings.yieldRate")}</SelectItem>
                                <SelectItem value="ng_count">{t("settings.ngCount")}</SelectItem>
                                <SelectItem value="machine_status">{t("settings.machineStatus")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.condition")} *</label>
                            <Select
                              value={alertForm.comparisonOperator}
                              onValueChange={(v) => setAlertForm({ ...alertForm, comparisonOperator: v as 'lt' | 'lte' | 'gt' | 'gte' | 'eq' })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="lt">{t("settings.lessThan")}</SelectItem>
                                <SelectItem value="lte">{t("settings.lessOrEqual")}</SelectItem>
                                <SelectItem value="gt">{t("settings.greaterThan")}</SelectItem>
                                <SelectItem value="gte">{t("settings.greaterOrEqual")}</SelectItem>
                                <SelectItem value="eq">{t("settings.equalTo")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.alertThresholdLabel")}<span className="text-destructive">*</span></label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              placeholder="90"
                              value={alertForm.threshold}
                              onChange={(e) => setAlertForm({ ...alertForm, threshold: e.target.value })}
                              onBlur={() => alertValidation.handleBlur("threshold", alertForm.threshold)}
                              className={`flex-1 ${alertValidation.hasError("threshold") ? "border-destructive" : ""}`}
                            />
                            <span className="text-muted-foreground">
                              {alertForm.alertType === 'yield_rate' ? '%' : alertForm.alertType === 'ng_count' ? t("settings.productUnit") : ''}
                            </span>
                          </div>
                          <ValidationMessage error={alertValidation.getFieldError("threshold")} />
                          <p className="text-xs text-muted-foreground">
                            {t("settings.alertExample")}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.factoryOptionalAll")}</label>
                            <Select
                              value={alertForm.factoryId}
                              onValueChange={(v) => setAlertForm({ ...alertForm, factoryId: v })}
                            >
                              <SelectTrigger><SelectValue placeholder={t("settings.allFactoriesShift")} /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">{t("settings.allFactoriesShift")}</SelectItem>
                                {factories?.map((f) => (
                                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.machineOptionalAll")}</label>
                            <Select
                              value={alertForm.machineId}
                              onValueChange={(v) => setAlertForm({ ...alertForm, machineId: v })}
                            >
                              <SelectTrigger><SelectValue placeholder={t("settings.allMachines")} /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">{t("settings.allMachines")}</SelectItem>
                                {machines?.map((m) => (
                                  <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.cooldownMinutes")}</label>
                          <Input
                            type="number"
                            min="5"
                            max="1440"
                            value={alertForm.cooldownMinutes}
                            onChange={(e) => setAlertForm({ ...alertForm, cooldownMinutes: e.target.value })}
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={alertForm.notifyEmail}
                              onChange={(e) => setAlertForm({ ...alertForm, notifyEmail: e.target.checked })}
                              className="rounded"
                            />
                            <span className="text-sm">{t("settings.sendEmail")}</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={alertForm.notifyInApp}
                              onChange={(e) => setAlertForm({ ...alertForm, notifyInApp: e.target.checked })}
                              className="rounded"
                            />
                            <span className="text-sm">{t("settings.inAppNotification")}</span>
                          </label>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setAlertDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => createAlertMutation.mutate({
                            name: alertForm.name,
                            alertType: alertForm.alertType,
                            threshold: parseFloat(alertForm.threshold),
                            comparisonOperator: alertForm.comparisonOperator,
                            machineId: alertForm.machineId && alertForm.machineId !== "all" ? parseInt(alertForm.machineId) : undefined,
                            factoryId: alertForm.factoryId && alertForm.factoryId !== "all" ? parseInt(alertForm.factoryId) : undefined,
                            notifyEmail: alertForm.notifyEmail,
                            notifyInApp: alertForm.notifyInApp,
                            cooldownMinutes: parseInt(alertForm.cooldownMinutes)
                          })}
                          disabled={createAlertMutation.isPending || !alertForm.name || !alertForm.threshold}
                        >
                          {createAlertMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("settings.createAlertBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {alerts?.map((alert: AlertSetting) => (
                    <div
                      key={alert.id}
                      className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                        alert.isActive ? 'bg-card hover:bg-muted/50' : 'bg-muted/30 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          alert.alertType === 'yield_rate' ? 'bg-success/20' :
                          alert.alertType === 'ng_count' ? 'bg-destructive/20' : 'bg-warning/20'
                        }`}>
                          {alert.alertType === 'yield_rate' ? (
                            <Target className="h-5 w-5 text-success" />
                          ) : alert.alertType === 'ng_count' ? (
                            <ThumbsDown className="h-5 w-5 text-destructive" />
                          ) : (
                            <AlertTriangle className="h-5 w-5 text-warning" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{alert.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {alert.alertType === 'yield_rate' ? t("settings.yieldRateShort") : 
                             alert.alertType === 'ng_count' ? t("settings.ngCount") : t("settings.machineStatus")}
                            {' '}
                            {alert.comparisonOperator === 'lt' ? '<' :
                             alert.comparisonOperator === 'lte' ? '≤' :
                             alert.comparisonOperator === 'gt' ? '>' :
                             alert.comparisonOperator === 'gte' ? '≥' : '='}
                            {' '}{alert.threshold}
                            {alert.alertType === 'yield_rate' ? '%' : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <PermissionGate module="settings_view" action="canEdit">
                          <Button
                            variant={alert.isActive ? "default" : "outline"}
                            size="sm"
                            onClick={() => updateAlertMutation.mutate({ id: alert.id, isActive: !alert.isActive })}
                          >
                            {alert.isActive ? t("settings.alertOn") : t("settings.alertOff")}
                          </Button>
                        </PermissionGate>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <PermissionGate module="settings_view" action="canEdit">
                              <DropdownMenuItem onClick={() => {
                                setEditingAlert(alert);
                                setEditAlertDialogOpen(true);
                              }}>
                                <Pencil className="h-4 w-4 mr-2" />
                                {t("settings.edit")}
                              </DropdownMenuItem>
                            </PermissionGate>
                            <PermissionGate module="settings_view" action="canDelete">
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  setAlertToDelete(alert);
                                  setDeleteAlertDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {t("common.delete")}
                              </DropdownMenuItem>
                            </PermissionGate>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                  {(!alerts || alerts.length === 0) && (
                    <EmptyState
                      icon={Bell}
                      title={t("settings.noAlerts")}
                      description={t("settings.noAlertsDesc")}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Yield Thresholds Tab */}
          <TabsContent value="yield-thresholds">
            <YieldThresholdSettings />
          </TabsContent>

          {/* Report Templates Tab */}
          <TabsContent value="report-templates">
            <ReportTemplates />
          </TabsContent>

          {/* Scheduled Reports Tab */}
          <TabsContent value="scheduled-reports">
            <ScheduledReports />
          </TabsContent>

            </div>
          </div>
        </Tabs>
        </ErrorBoundary>
      </PageContainer>

      {/* Edit Alert Dialog */}
      <Dialog open={editAlertDialogOpen} onOpenChange={setEditAlertDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.editAlert")}</DialogTitle>
          </DialogHeader>
          {editingAlert && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.alertName")}</label>
                <Input
                  value={editingAlert.name}
                  onChange={(e) => setEditingAlert({ ...editingAlert, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.alertThresholdLabel")}</label>
                <Input
                  type="number"
                  value={editingAlert.threshold}
                  onChange={(e) => setEditingAlert({ ...editingAlert, threshold: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.cooldownLabel")}</label>
                <Input
                  type="number"
                  min="5"
                  max="1440"
                  value={editingAlert.cooldownMinutes}
                  onChange={(e) => setEditingAlert({ ...editingAlert, cooldownMinutes: parseInt(e.target.value) })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAlertDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={() => editingAlert && updateAlertMutation.mutate({
                id: editingAlert.id,
                name: editingAlert.name,
                threshold: parseFloat(editingAlert.threshold),
                cooldownMinutes: editingAlert.cooldownMinutes
              })}
              disabled={updateAlertMutation.isPending}
            >
              {updateAlertMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialogs */}
      <DeleteConfirmDialog
        open={deleteAlertDialogOpen}
        onOpenChange={setDeleteAlertDialogOpen}
        itemType={t("settings.sidebar.alert")}
        itemName={alertToDelete?.name}
        onConfirm={() => {
          if (alertToDelete) {
            deleteAlertMutation.mutate({ id: alertToDelete.id });
            setDeleteAlertDialogOpen(false);
            setAlertToDelete(null);
          }
        }}
        isLoading={deleteAlertMutation.isPending}
      />
    </DashboardLayout>
  );
}
