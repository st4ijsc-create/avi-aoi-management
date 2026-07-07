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

  // doc 39 Wave 4: the standalone Custom Dashboard / Templates / Marketplace routes
  // all redirect INTO this hub, and each embedded surface enforces its own write
  // RBAC — so gating the whole hub on role==='admin' created a split-brain where a
  // redirected non-admin hit an "admin only" wall. The hub is now open to any role
  // that can reach the route (RouteGuard governs entry); write actions stay gated.
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
              <div className="hidden" data-legacy-hub-menu="true">
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
