/**
 * doc 59 Cụm D — Data Management Hub: ONE professional "data home" gom các bề mặt
 * data-management rải rác. Hub-launcher trên HubLauncher (rail category ⇄ ToolTile) +
 * PER-TILE RBAC (doc 59 cụm phụ: đổi từ WorkspaceShell+Card thủ công sang HubLauncher để
 * ẩn tile user thiếu quyền — hết dead-end khi nav-collapse ép đi qua hub). Managers mở
 * deep-link (chúng chưa có *Content để full-embed); route giữ nguyên.
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { HubLauncher, type HubCategory } from "@/components/workspace";
import {
  Package, Sparkles, Link as LinkIcon, Cpu, Tags, Users, History, ShieldCheck, BookOpen,
  Database, LayoutTemplate, Building2, Workflow,
} from "lucide-react";

const CATEGORIES: readonly HubCategory[] = [
  {
    key: "productProgram",
    label: "dataHub.productprogram",
    icon: <Package className="h-4 w-4" />,
    tools: [
      { icon: Package, label: "dataHub.products", blurb: "dataHub.productsBlurb", href: "/products", requiredPermission: "settings_products" },
      { icon: Sparkles, label: "dataHub.productOnboarding", blurb: "dataHub.productOnboardingBlurb", href: "/product-onboarding", requiredPermission: "settings_products" },
      { icon: LinkIcon, label: "dataHub.productMapping", blurb: "dataHub.productMappingBlurb", href: "/product-mapping", requiredPermission: "settings_product_mapping" },
      { icon: Cpu, label: "dataHub.componentLibrary", blurb: "dataHub.componentLibraryBlurb", href: "/component-library", requiredPermission: "masterdata" },
    ],
  },
  {
    key: "masterData",
    label: "dataHub.masterdata",
    icon: <Tags className="h-4 w-4" />,
    tools: [
      { icon: Tags, label: "dataHub.masterData", blurb: "dataHub.masterDataBlurb", href: "/master-data", requiredPermission: "masterdata" },
      { icon: Users, label: "dataHub.operatorBadges", blurb: "dataHub.operatorBadgesBlurb", href: "/operator-badges", requiredPermission: "masterdata" },
      { icon: BookOpen, label: "dataHub.metricCatalog", blurb: "dataHub.metricCatalogBlurb", href: "/metric-catalog", requiredPermission: "machine_status" },
      { icon: History, label: "dataHub.masterDataAudit", blurb: "dataHub.masterDataAuditBlurb", href: "/master-data-audit", requiredPermission: "masterdata" },
      { icon: ShieldCheck, label: "dataHub.dataQuality", blurb: "dataHub.dataQualityBlurb", href: "/data-quality", requiredPermission: "masterdata" },
    ],
  },
  {
    key: "factoryConfig",
    label: "dataHub.factoryconfig",
    icon: <Building2 className="h-4 w-4" />,
    tools: [
      { icon: Database, label: "dataHub.datasettings", blurb: "dataHub.datasettingsBlurb", href: "/datasettings", requiredPermission: "settings_factory" },
      { icon: LayoutTemplate, label: "dataHub.workstationManagement", blurb: "dataHub.workstationManagementBlurb", href: "/workstation-management", requiredPermission: "settings_factory" },
      { icon: Workflow, label: "dataHub.processManagement", blurb: "dataHub.processManagementBlurb", href: "/process-management", requiredPermission: "settings_factory" },
      { icon: LayoutTemplate, label: "dataHub.layout", blurb: "dataHub.layoutBlurb", href: "/layout", requiredPermission: "settings_factory" },
    ],
  },
];

export default function DataManagementHub() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("dataHub.title", "Quản lý dữ liệu")}>
      <HubLauncher categories={CATEGORIES} categoriesLabel={t("dataHub.categories", "Nhóm dữ liệu")} />
    </DashboardLayout>
  );
}
