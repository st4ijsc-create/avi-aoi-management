import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import EmbeddedCustomDashboard from "@/components/EmbeddedCustomDashboard";
import EmbeddedDashboardTemplates from "@/components/EmbeddedDashboardTemplates";
import EmbeddedDashboardMarketplace from "@/components/EmbeddedDashboardMarketplace";
import {
  Shield,
  Users,
  UserCog,
  Mail,
  Server,
  Activity,
  ScrollText,
  LayoutDashboard,
  FileText,
  ShoppingBag,
  Database,
  HardDrive,
  Upload,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Settings as SettingsIcon,
  Lock,
  Archive,
  Wrench,
  BarChart3,
  ExternalLink,
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SMTPConfig } from "@/components/SMTPConfig";
import { CacheStatsDashboard } from "@/components/CacheStatsDashboard";
import { EmailTemplateEditor } from "@/components/EmailTemplateEditor";
import UserAssignments from "@/components/UserAssignments";
import { PermissionsManagement } from "@/components/PermissionsManagement";
import { RoleManagement } from "@/components/RoleManagement";
import { AuditLogContent } from "@/pages/AuditLogs";
import { SystemConfigContent } from "@/pages/SystemConfiguration";
import { ImportExportContent } from "@/pages/ImportExport";
import { BackupRestorePageContent } from "@/pages/BackupRestore";
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";

export default function AdminPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const search = useSearch();
  const [location, setLocation] = useLocation();

  const getTabFromUrl = () => {
    const params = new URLSearchParams(search);
    return params.get("tab") || "overview";
  };

  const [activeTab, setActiveTab] = useState(getTabFromUrl);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setLocation(`/admin?tab=${tab}`);
  };

  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [search]);

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  // Seed mutations
  const seedDataMutation = trpc.seedData.seed.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
    },
    onError: (error) => toast.error(error.message),
  });

  const seedInspectionsMutation = trpc.seedData.seedInspections.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
    },
    onError: (error) => toast.error(error.message),
  });

  if (!isAdmin) {
    return (
      <DashboardLayout title={t("admin.title")} navItems={navItems} currentPath="/admin">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <Shield className="h-16 w-16 text-muted-foreground/50" />
          <p className="text-xl font-medium text-foreground">{t("admin.adminOnlyAccess")}</p>
          <p className="text-muted-foreground">{t("admin.contactAdmin")}</p>
        </div>
      </DashboardLayout>
    );
  }

  // Sidebar config
  const sidebarCategories = [
    {
      id: "overview",
      label: t("admin.cat.overview"),
      icon: <BarChart3 className="h-4 w-4 text-indigo-500" />,
      items: [
        { id: "overview", label: t("admin.sidebar.overview"), icon: <BarChart3 className="h-4 w-4" /> },
      ],
    },
    {
      id: "users",
      label: t("admin.cat.userAccess"),
      icon: <Users className="h-4 w-4 text-blue-500" />,
      items: [
        { id: "user-assignments", label: t("admin.sidebar.userAssignments"), icon: <UserCog className="h-4 w-4" /> },
        { id: "permissions", label: t("admin.sidebar.permissions"), icon: <Lock className="h-4 w-4" /> },
        { id: "roles", label: t("admin.sidebar.roles"), icon: <Shield className="h-4 w-4" /> },
      ],
    },
    {
      id: "communication",
      label: t("admin.cat.communication"),
      icon: <Mail className="h-4 w-4 text-green-500" />,
      items: [
        { id: "smtp-config", label: t("admin.sidebar.smtpConfig"), icon: <Server className="h-4 w-4" /> },
        { id: "email-template", label: t("admin.sidebar.emailTemplate"), icon: <Mail className="h-4 w-4" /> },
      ],
    },
    {
      id: "dashboards",
      label: t("admin.cat.dashboardCenter"),
      icon: <LayoutDashboard className="h-4 w-4 text-purple-500" />,
      items: [
        { id: "custom-dashboard", label: t("admin.sidebar.customDashboard"), icon: <LayoutDashboard className="h-4 w-4" /> },
        { id: "dashboard-templates", label: t("admin.sidebar.dashboardTemplates"), icon: <FileText className="h-4 w-4" /> },
        { id: "dashboard-marketplace", label: t("admin.sidebar.dashboardMarketplace"), icon: <ShoppingBag className="h-4 w-4" /> },
      ],
    },
    {
      id: "monitoring",
      label: t("admin.cat.monitoring"),
      icon: <Activity className="h-4 w-4 text-orange-500" />,
      items: [
        { id: "audit-logs", label: t("admin.sidebar.auditLogs"), icon: <ScrollText className="h-4 w-4" /> },
        { id: "cache-stats", label: t("admin.sidebar.cacheStats"), icon: <Database className="h-4 w-4" /> },
      ],
    },
    {
      id: "system-tools",
      label: t("admin.cat.systemTools"),
      icon: <Wrench className="h-4 w-4 text-red-500" />,
      items: [
        { id: "system-config", label: t("admin.sidebar.systemConfig"), icon: <SettingsIcon className="h-4 w-4" /> },
        { id: "backup-restore", label: t("admin.sidebar.backupRestore"), icon: <Archive className="h-4 w-4" /> },
        { id: "import-export", label: t("admin.sidebar.importExport"), icon: <Upload className="h-4 w-4" /> },
        { id: "data-seeding", label: t("admin.sidebar.dataSeeding"), icon: <HardDrive className="h-4 w-4" /> },
      ],
    },
  ];

  return (
    <DashboardLayout title={t("admin.title")} navItems={navItems} currentPath="/admin">
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              {t("admin.pageTitle")}
            </h1>
            <p className="text-muted-foreground">{t("admin.pageDescription")}</p>
          </div>
        </div>

        <ErrorBoundary>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="flex gap-6">
              {/* Sidebar Navigation */}
              <div className="w-64 shrink-0 space-y-1">
                {sidebarCategories.map((category) => (
                  <div key={category.id} className="space-y-1">
                    {category.items.length === 1 && category.id === "overview" ? (
                      // Single overview item - no collapsible
                      <button
                        onClick={() => handleTabChange(category.items[0].id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                          activeTab === category.items[0].id
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent"
                        }`}
                      >
                        {category.icon}
                        <span>{category.label}</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => toggleCategory(category.id)}
                          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {category.icon}
                            <span>{category.label}</span>
                          </div>
                          {collapsedCategories[category.id] ? (
                            <ChevronRight className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                        {!collapsedCategories[category.id] && (
                          <div className="ml-6 space-y-1">
                            {category.items.map((item) => (
                              <button
                                key={item.id}
                                onClick={() => handleTabChange(item.id)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                                  activeTab === item.id
                                    ? "bg-primary text-primary-foreground"
                                    : "hover:bg-accent"
                                }`}
                              >
                                {item.icon}
                                {item.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Main Content */}
              <div className="flex-1 min-w-0">
                {/* Overview Tab */}
                <TabsContent value="overview">
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* User & Access Card */}
                      <Card className="glass-card hover:border-blue-500/30 transition-colors cursor-pointer" onClick={() => handleTabChange("user-assignments")}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-500/10">
                              <Users className="h-5 w-5 text-blue-500" />
                            </div>
                            <div>
                              <CardTitle className="text-base">{t("admin.overview.userAccess")}</CardTitle>
                              <CardDescription className="text-xs">{t("admin.overview.userAccessDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-blue-500/10 text-blue-500">{t("admin.sidebar.userAssignments")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-blue-500/10 text-blue-500">{t("admin.sidebar.permissions")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-blue-500/10 text-blue-500">{t("admin.sidebar.roles")}</span>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Communication Card */}
                      <Card className="glass-card hover:border-green-500/30 transition-colors cursor-pointer" onClick={() => handleTabChange("smtp-config")}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-green-500/10">
                              <Mail className="h-5 w-5 text-green-500" />
                            </div>
                            <div>
                              <CardTitle className="text-base">{t("admin.overview.communication")}</CardTitle>
                              <CardDescription className="text-xs">{t("admin.overview.communicationDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-green-500/10 text-green-500">{t("admin.sidebar.smtpConfig")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-green-500/10 text-green-500">{t("admin.sidebar.emailTemplate")}</span>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Dashboard Center Card */}
                      <Card className="glass-card hover:border-purple-500/30 transition-colors cursor-pointer" onClick={() => handleTabChange("custom-dashboard")}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-500/10">
                              <LayoutDashboard className="h-5 w-5 text-purple-500" />
                            </div>
                            <div>
                              <CardTitle className="text-base">{t("admin.overview.dashboardCenter")}</CardTitle>
                              <CardDescription className="text-xs">{t("admin.overview.dashboardCenterDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-purple-500/10 text-purple-500">{t("admin.sidebar.customDashboard")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-purple-500/10 text-purple-500">{t("admin.sidebar.dashboardTemplates")}</span>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Monitoring Card */}
                      <Card className="glass-card hover:border-orange-500/30 transition-colors cursor-pointer" onClick={() => handleTabChange("audit-logs")}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-orange-500/10">
                              <Activity className="h-5 w-5 text-orange-500" />
                            </div>
                            <div>
                              <CardTitle className="text-base">{t("admin.overview.monitoring")}</CardTitle>
                              <CardDescription className="text-xs">{t("admin.overview.monitoringDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-orange-500/10 text-orange-500">{t("admin.sidebar.auditLogs")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-orange-500/10 text-orange-500">{t("admin.sidebar.cacheStats")}</span>
                          </div>
                        </CardContent>
                      </Card>

                      {/* System Tools Card */}
                      <Card className="glass-card hover:border-red-500/30 transition-colors cursor-pointer" onClick={() => handleTabChange("system-config")}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-red-500/10">
                              <Wrench className="h-5 w-5 text-red-500" />
                            </div>
                            <div>
                              <CardTitle className="text-base">{t("admin.overview.systemTools")}</CardTitle>
                              <CardDescription className="text-xs">{t("admin.overview.systemToolsDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-red-500/10 text-red-500">{t("admin.sidebar.systemConfig")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-red-500/10 text-red-500">{t("admin.sidebar.backupRestore")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-red-500/10 text-red-500">{t("admin.sidebar.importExport")}</span>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Data Seeding Card */}
                      <Card className="glass-card hover:border-amber-500/30 transition-colors cursor-pointer" onClick={() => handleTabChange("data-seeding")}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-amber-500/10">
                              <HardDrive className="h-5 w-5 text-amber-500" />
                            </div>
                            <div>
                              <CardTitle className="text-base">{t("admin.overview.dataSeeding")}</CardTitle>
                              <CardDescription className="text-xs">{t("admin.overview.dataSeedingDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-amber-500/10 text-amber-500">{t("admin.sidebar.dataSeeding")}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </TabsContent>

                {/* User Assignments Tab */}
                <TabsContent value="user-assignments">
                  <UserAssignments />
                </TabsContent>

                {/* Permissions Tab */}
                <TabsContent value="permissions">
                  <PermissionsManagement />
                </TabsContent>

                {/* Roles Tab */}
                <TabsContent value="roles">
                  <RoleManagement />
                </TabsContent>

                {/* SMTP Config Tab */}
                <TabsContent value="smtp-config">
                  <SMTPConfig />
                </TabsContent>

                {/* Email Template Tab */}
                <TabsContent value="email-template">
                  <EmailTemplateEditor />
                </TabsContent>

                {/* Custom Dashboard Tab */}
                <TabsContent value="custom-dashboard">
                  <EmbeddedCustomDashboard />
                </TabsContent>

                {/* Dashboard Templates Tab */}
                <TabsContent value="dashboard-templates">
                  <EmbeddedDashboardTemplates />
                </TabsContent>

                {/* Dashboard Marketplace Tab */}
                <TabsContent value="dashboard-marketplace">
                  <EmbeddedDashboardMarketplace />
                </TabsContent>

                {/* Audit Logs Tab */}
                <TabsContent value="audit-logs">
                  <AuditLogContent />
                </TabsContent>

                {/* Cache Stats Tab */}
                <TabsContent value="cache-stats">
                  <CacheStatsDashboard />
                </TabsContent>

                {/* System Config Tab */}
                <TabsContent value="system-config">
                  <SystemConfigContent />
                </TabsContent>

                {/* Backup & Restore Tab */}
                <TabsContent value="backup-restore">
                  <BackupRestorePageContent />
                </TabsContent>

                {/* Import / Export Tab */}
                <TabsContent value="import-export">
                  <ImportExportContent />
                </TabsContent>

                {/* Data Seeding Tab */}
                <TabsContent value="data-seeding">
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-primary" />
                        {t("admin.dataSeedingTitle")}
                      </CardTitle>
                      <CardDescription>{t("admin.dataSeedingDesc")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Seed Infrastructure Data */}
                        <Card className="border-dashed">
                          <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                              <Database className="h-4 w-4 text-blue-500" />
                              {t("admin.seedInfraTitle")}
                            </CardTitle>
                            <CardDescription>{t("admin.seedInfraDesc")}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <Button
                              variant="outline"
                              className="w-full gap-2"
                              onClick={() => seedDataMutation.mutate()}
                              disabled={seedDataMutation.isPending}
                            >
                              {seedDataMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                              {t("admin.seedDataBtn")}
                            </Button>
                          </CardContent>
                        </Card>

                        {/* Seed Inspections */}
                        <Card className="border-dashed">
                          <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                              <BarChart3 className="h-4 w-4 text-green-500" />
                              {t("admin.seedInspectionsTitle")}
                            </CardTitle>
                            <CardDescription>{t("admin.seedInspectionsDesc")}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <Button
                              variant="outline"
                              className="w-full gap-2"
                              onClick={() => seedInspectionsMutation.mutate({ count: 100 })}
                              disabled={seedInspectionsMutation.isPending}
                            >
                              {seedInspectionsMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                              {t("admin.seedInspectionsBtn")}
                            </Button>
                          </CardContent>
                        </Card>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>
            </div>
          </Tabs>
        </ErrorBoundary>
      </div>
    </DashboardLayout>
  );
}
