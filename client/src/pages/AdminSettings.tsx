import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AdvancedSection } from "@/components/AdvancedSection";

import { SMTPConfig } from "@/components/SMTPConfig";
import { CacheStatsDashboard } from "@/components/CacheStatsDashboard";
import { EmailTemplateEditor } from "@/components/EmailTemplateEditor";
import UserAssignments from "@/components/UserAssignments";
import { PermissionsManagement } from "@/components/PermissionsManagement";
import { RoleManagement } from "@/components/RoleManagement";

import {
  Shield,
  Users,
  UserCog,
  Mail,
  Server,
  Activity,
  ScrollText,
  FileText,
  Database,
  HardDrive,
  Upload,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Settings,
  Lock,
  Archive,
  Wrench,
  BarChart3,
  KeyRound,
} from "lucide-react";

import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";

// Import content components from existing pages
import { RoleBuilderContent } from "@/pages/RoleBuilder";
import { EnhancedAuditLogsContent } from "@/pages/EnhancedAuditLogs";
import { ApiDocsContent } from "@/pages/ApiDocs";
import { LicenseManagementContent } from "@/pages/LicenseManagement";
import { AuditLogContent } from "@/pages/AuditLogs";
import { SystemConfigContent } from "@/pages/SystemConfiguration";
import { ImportExportContent } from "@/pages/ImportExport";
import { BackupRestorePageContent } from "@/pages/BackupRestore";

export default function AdminSettings() {
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

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setLocation(`/admin-setting?tab=${tab}`);
  };

  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [search]);

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  // Seed mutations
  const seedDataMutation = trpc.seedData.seed.useMutation({
    onSuccess: (data) => { toast.success(data.message); },
    onError: (error) => toast.error(error.message),
  });
  const seedInspectionsMutation = trpc.seedData.seedInspections.useMutation({
    onSuccess: (data) => { toast.success(data.message); },
    onError: (error) => toast.error(error.message),
  });

  if (!isAdmin) {
    return (
      <DashboardLayout title={t("adminSettings.title")} navItems={navItems} currentPath="/admin-setting">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <Shield className="h-16 w-16 text-muted-foreground/50" />
          <p className="text-xl font-medium text-foreground">{t("settings.adminOnlyAccess")}</p>
          <p className="text-muted-foreground">{t("settings.contactAdmin")}</p>
        </div>
      </DashboardLayout>
    );
  }

  const sidebarButton = (tab: string, icon: React.ReactNode, label: string) => (
    <button
      key={tab}
      onClick={() => handleTabChange(tab)}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
        activeTab === tab ? "bg-primary text-primary-foreground" : "hover:bg-accent"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const sidebarCategories = [
    {
      id: "users",
      label: t("adminSettings.cat.userAccess"),
      icon: <Users className="h-4 w-4 text-blue-500" />,
      items: [
        { id: "user-assignments", label: t("adminSettings.sidebar.userAssignments"), icon: <UserCog className="h-4 w-4" /> },
        { id: "permissions", label: t("adminSettings.sidebar.permissions"), icon: <Lock className="h-4 w-4" /> },
        { id: "roles", label: t("adminSettings.sidebar.roles"), icon: <Shield className="h-4 w-4" /> },
        { id: "role-builder", label: t("adminSettings.sidebar.roleBuilder"), icon: <Wrench className="h-4 w-4" /> },
        { id: "enhanced-audit", label: t("adminSettings.sidebar.auditTrail"), icon: <ScrollText className="h-4 w-4" /> },
      ],
    },
    {
      id: "communication",
      label: t("adminSettings.cat.communication"),
      icon: <Mail className="h-4 w-4 text-green-500" />,
      items: [
        { id: "smtp-config", label: t("adminSettings.sidebar.smtpConfig"), icon: <Server className="h-4 w-4" /> },
        { id: "email-template", label: t("adminSettings.sidebar.emailTemplate"), icon: <Mail className="h-4 w-4" /> },
      ],
    },
    {
      id: "monitoring",
      label: t("adminSettings.cat.monitoring"),
      icon: <Activity className="h-4 w-4 text-orange-500" />,
      items: [
        { id: "audit-logs", label: t("adminSettings.sidebar.auditLogs"), icon: <ScrollText className="h-4 w-4" /> },
        { id: "cache-stats", label: t("adminSettings.sidebar.cacheStats"), icon: <Database className="h-4 w-4" /> },
      ],
    },
    {
      id: "system-tools",
      label: t("adminSettings.cat.systemTools"),
      icon: <Wrench className="h-4 w-4 text-red-500" />,
      items: [
        { id: "api-docs", label: t("adminSettings.sidebar.apiDocs"), icon: <FileText className="h-4 w-4" /> },
        { id: "license", label: t("adminSettings.sidebar.license"), icon: <KeyRound className="h-4 w-4" /> },
        { id: "system-config", label: t("adminSettings.sidebar.systemConfig"), icon: <Settings className="h-4 w-4" /> },
        { id: "backup-restore", label: t("adminSettings.sidebar.backupRestore"), icon: <Archive className="h-4 w-4" /> },
        { id: "import-export", label: t("adminSettings.sidebar.importExport"), icon: <Upload className="h-4 w-4" /> },
        { id: "data-seeding", label: t("adminSettings.sidebar.dataSeeding"), icon: <HardDrive className="h-4 w-4" /> },
      ],
    },
  ];

  return (
    <DashboardLayout title={t("adminSettings.title")} navItems={navItems} currentPath="/admin-setting">
      <PageContainer>
        <PageHeader
          icon={<Settings className="h-6 w-6" />}
          title={t("adminSettings.title")}
          description={t("adminSettings.description")}
        />

        <ErrorBoundary>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="flex gap-6">
              {/* Vertical Sidebar Navigation */}
              <div className="hidden" data-legacy-hub-menu="true">
                {/* Overview button */}
                <button
                  onClick={() => handleTabChange("overview")}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    activeTab === "overview" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  }`}
                >
                  <BarChart3 className="h-4 w-4 text-indigo-500" />
                  <span>{t("adminSettings.sidebar.overview")}</span>
                </button>

                {/* Dynamic categories */}
                {sidebarCategories.map((category) => (
                  <div key={category.id} className="space-y-1">
                    <button
                      onClick={() => toggleCategory(category.id)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {category.icon}
                        <span>{category.label}</span>
                      </div>
                      {collapsedCategories[category.id] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {!collapsedCategories[category.id] && (
                      <div className="ml-6 space-y-1">
                        {category.items.map((item) => sidebarButton(item.id, item.icon, item.label))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Content Area */}
              <div className="flex-1 min-w-0">
                {/* Overview Tab */}
                <TabsContent value="overview" className="mt-0">
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
                              <CardTitle className="text-base">{t("adminSettings.overview.userAccess")}</CardTitle>
                              <CardDescription className="text-xs">{t("adminSettings.overview.userAccessDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-blue-500/10 text-blue-500">{t("adminSettings.sidebar.userAssignments")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-blue-500/10 text-blue-500">{t("adminSettings.sidebar.permissions")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-blue-500/10 text-blue-500">{t("adminSettings.sidebar.roles")}</span>
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
                              <CardTitle className="text-base">{t("adminSettings.overview.communication")}</CardTitle>
                              <CardDescription className="text-xs">{t("adminSettings.overview.communicationDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-green-500/10 text-green-500">{t("adminSettings.sidebar.smtpConfig")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-green-500/10 text-green-500">{t("adminSettings.sidebar.emailTemplate")}</span>
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
                              <CardTitle className="text-base">{t("adminSettings.overview.monitoring")}</CardTitle>
                              <CardDescription className="text-xs">{t("adminSettings.overview.monitoringDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-orange-500/10 text-orange-500">{t("adminSettings.sidebar.auditLogs")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-orange-500/10 text-orange-500">{t("adminSettings.sidebar.cacheStats")}</span>
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
                              <CardTitle className="text-base">{t("adminSettings.overview.systemTools")}</CardTitle>
                              <CardDescription className="text-xs">{t("adminSettings.overview.systemToolsDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-red-500/10 text-red-500">{t("adminSettings.sidebar.systemConfig")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-red-500/10 text-red-500">{t("adminSettings.sidebar.backupRestore")}</span>
                            <span className="px-2 py-1 rounded-full text-xs bg-red-500/10 text-red-500">{t("adminSettings.sidebar.importExport")}</span>
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
                              <CardTitle className="text-base">{t("adminSettings.overview.dataSeeding")}</CardTitle>
                              <CardDescription className="text-xs">{t("adminSettings.overview.dataSeedingDesc")}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded-full text-xs bg-amber-500/10 text-amber-500">{t("adminSettings.sidebar.dataSeeding")}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </TabsContent>

                {/* User & Access Tabs */}
                <TabsContent value="user-assignments" className="mt-0">
                  <ErrorBoundary><UserAssignments /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="permissions" className="mt-0">
                  <ErrorBoundary><PermissionsManagement /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="roles" className="mt-0">
                  <ErrorBoundary><RoleManagement /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="role-builder" className="mt-0">
                  <ErrorBoundary><RoleBuilderContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="enhanced-audit" className="mt-0">
                  <ErrorBoundary><EnhancedAuditLogsContent /></ErrorBoundary>
                </TabsContent>

                {/* Communication Tabs */}
                <TabsContent value="smtp-config" className="mt-0">
                  <ErrorBoundary><SMTPConfig /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="email-template" className="mt-0">
                  <ErrorBoundary><EmailTemplateEditor /></ErrorBoundary>
                </TabsContent>

                {/* Monitoring Tabs */}
                <TabsContent value="audit-logs" className="mt-0">
                  <ErrorBoundary><AuditLogContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="cache-stats" className="mt-0">
                  <ErrorBoundary><CacheStatsDashboard /></ErrorBoundary>
                </TabsContent>

                {/* System Tools Tabs */}
                <TabsContent value="api-docs" className="mt-0">
                  <ErrorBoundary><ApiDocsContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="license" className="mt-0">
                  <ErrorBoundary><LicenseManagementContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="system-config" className="mt-0">
                  <ErrorBoundary><SystemConfigContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="backup-restore" className="mt-0">
                  <ErrorBoundary><BackupRestorePageContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="import-export" className="mt-0">
                  <ErrorBoundary><ImportExportContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="data-seeding" className="mt-0">
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-primary" />
                        {t("admin.dataSeedingTitle")}
                      </CardTitle>
                      <CardDescription>{t("admin.dataSeedingDesc")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {/* Progressive disclosure: seeding tools are advanced/destructive —
                          collapsed by default (preference persisted). Nothing removed. */}
                      <AdvancedSection storageKey="admin-data-seeding">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="border-dashed">
                          <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                              <Database className="h-4 w-4 text-blue-500" />
                              {t("admin.seedInfraTitle")}
                            </CardTitle>
                            <CardDescription>{t("admin.seedInfraDesc")}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <Button variant="outline" className="w-full gap-2" onClick={() => seedDataMutation.mutate()} disabled={seedDataMutation.isPending}>
                              {seedDataMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              {t("admin.seedDataBtn")}
                            </Button>
                          </CardContent>
                        </Card>
                        <Card className="border-dashed">
                          <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                              <BarChart3 className="h-4 w-4 text-green-500" />
                              {t("admin.seedInspectionsTitle")}
                            </CardTitle>
                            <CardDescription>{t("admin.seedInspectionsDesc")}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <Button variant="outline" className="w-full gap-2" onClick={() => seedInspectionsMutation.mutate({ count: 100 })} disabled={seedInspectionsMutation.isPending}>
                              {seedInspectionsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              {t("admin.seedInspectionsBtn")}
                            </Button>
                          </CardContent>
                        </Card>
                      </div>
                      </AdvancedSection>
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>
            </div>
          </Tabs>
        </ErrorBoundary>
      </PageContainer>
    </DashboardLayout>
  );
}
