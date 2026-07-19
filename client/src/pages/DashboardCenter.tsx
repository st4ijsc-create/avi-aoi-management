import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { TabbedHub, type TabbedHubTab } from "@/components/workspace";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import CustomDashboardContent from "@/components/CustomDashboardContent";
import EmbeddedDashboardTemplates from "@/components/EmbeddedDashboardTemplates";
import EmbeddedDashboardMarketplace from "@/components/EmbeddedDashboardMarketplace";

import { LayoutDashboard, FileText, ShoppingBag } from "lucide-react";

// doc 67 W8 (việc 1) — tab strip HIỆN: khối nút cũ bị className="hidden"
// (data-legacy-hub-menu) khiến 2/3 tab không có đường vào bằng UI. Thay bằng
// primitive TabbedHub (doc 59) — tab strip visible + sync ?tab= (giữ nguyên
// 3 giá trị tab cũ nên deep-link/redirect /custom-dashboard... không đổi).
// `embedded` (P3): tab con bỏ h2+description lặp vì PageHeader hub đã có.
const CustomDashboardTab = () => (
  <ErrorBoundary>
    <CustomDashboardContent embedded />
  </ErrorBoundary>
);
const TemplatesTab = () => (
  <ErrorBoundary>
    <EmbeddedDashboardTemplates embedded />
  </ErrorBoundary>
);
const MarketplaceTab = () => (
  <ErrorBoundary>
    <EmbeddedDashboardMarketplace />
  </ErrorBoundary>
);

const HUB_TABS: readonly TabbedHubTab[] = [
  {
    value: "custom-dashboard",
    labelKey: "dashboardCenter.sidebar.customDashboard",
    fallback: "Tùy chỉnh",
    icon: <LayoutDashboard className="h-4 w-4" />,
    Content: CustomDashboardTab,
  },
  {
    value: "dashboard-templates",
    labelKey: "dashboardCenter.sidebar.dashboardTemplates",
    fallback: "Mẫu",
    icon: <FileText className="h-4 w-4" />,
    Content: TemplatesTab,
  },
  {
    value: "dashboard-marketplace",
    labelKey: "dashboardCenter.sidebar.dashboardMarketplace",
    fallback: "Chợ",
    icon: <ShoppingBag className="h-4 w-4" />,
    Content: MarketplaceTab,
  },
];

export default function DashboardCenter() {
  const { t } = useTranslation();

  // doc 39 Wave 4: the standalone Custom Dashboard / Templates / Marketplace routes
  // all redirect INTO this hub, and each embedded surface enforces its own write
  // RBAC — so gating the whole hub on role==='admin' created a split-brain where a
  // redirected non-admin hit an "admin only" wall. The hub is now open to any role
  // that can reach the route (RouteGuard governs entry); write actions stay gated.
  return (
    <DashboardLayout title={t("nav.dashboardCenter", "Dashboard Management")} navItems={navItems} currentPath="/dashboard-center">
      <div className="space-y-6">
        {/* doc 67 W5 (việc 1) — 1 key/trang: h1 = breadcrumb = menu = nav.dashboardCenter. */}
        <PageHeader
          icon={<LayoutDashboard className="h-6 w-6" />}
          title={t("nav.dashboardCenter", "Dashboard Management")}
          description={t("dashboardCenter.description")}
        />

        <ErrorBoundary>
          <TabbedHub tabs={HUB_TABS} basePath="/dashboard-center" defaultTab="custom-dashboard" />
        </ErrorBoundary>
      </div>
    </DashboardLayout>
  );
}
