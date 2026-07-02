import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import EmbeddedCustomDashboard from "@/components/EmbeddedCustomDashboard";
import EmbeddedDashboardTemplates from "@/components/EmbeddedDashboardTemplates";
import EmbeddedDashboardMarketplace from "@/components/EmbeddedDashboardMarketplace";

import {
  Shield,
  LayoutDashboard,
  FileText,
  ShoppingBag,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";

export default function DashboardCenter() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const search = useSearch();
  const [, setLocation] = useLocation();

  const getTabFromUrl = () => {
    const params = new URLSearchParams(search);
    return params.get("tab") || "custom-dashboard";
  };

  const [activeTab, setActiveTab] = useState(getTabFromUrl);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setLocation(`/dashboard-center?tab=${tab}`);
  };

  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [search]);

  if (!isAdmin) {
    return (
      <DashboardLayout title={t("dashboardCenter.title")} navItems={navItems} currentPath="/dashboard-center">
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

  return (
    <DashboardLayout title={t("dashboardCenter.title")} navItems={navItems} currentPath="/dashboard-center">
      <div className="space-y-6">
        <PageHeader
          icon={<LayoutDashboard className="h-6 w-6" />}
          title={t("dashboardCenter.title")}
          description={t("dashboardCenter.description")}
        />

        <ErrorBoundary>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="flex gap-6">
              {/* Vertical Sidebar Navigation */}
              <div className="w-64 shrink-0 space-y-1">
                {sidebarButton("custom-dashboard", <LayoutDashboard className="h-4 w-4" />, t("dashboardCenter.sidebar.customDashboard"))}
                {sidebarButton("dashboard-templates", <FileText className="h-4 w-4" />, t("dashboardCenter.sidebar.dashboardTemplates"))}
                {sidebarButton("dashboard-marketplace", <ShoppingBag className="h-4 w-4" />, t("dashboardCenter.sidebar.dashboardMarketplace"))}
              </div>

              {/* Content Area */}
              <div className="flex-1 min-w-0">
                <TabsContent value="custom-dashboard" className="mt-0">
                  <ErrorBoundary><EmbeddedCustomDashboard /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="dashboard-templates" className="mt-0">
                  <ErrorBoundary><EmbeddedDashboardTemplates /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="dashboard-marketplace" className="mt-0">
                  <ErrorBoundary><EmbeddedDashboardMarketplace /></ErrorBoundary>
                </TabsContent>
              </div>
            </div>
          </Tabs>
        </ErrorBoundary>
      </div>
    </DashboardLayout>
  );
}
