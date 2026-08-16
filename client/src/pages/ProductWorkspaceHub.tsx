/**
 * doc 59 Cụm E — Product Workspace: ONE home for "định nghĩa what-good-looks-like cho
 * sản phẩm", đang rải qua 3 nhóm nav. Hub-launcher (HubLauncher rail ⇄ ToolTile) — 7/9
 * surface không có *Content và ProductModels là monolith ~3500 dòng (master-detail nội bộ
 * riêng), nên full-embed là bất khả thi/high-regression; launcher hợp nhất CỬA VÀO + giữ
 * mọi route (kể cả /products?product=) sống nguyên. PER-TILE RBAC: 9 surface trải 5 quyền
 * → mỗi tile gate riêng, nav gate ở BẬC THẤP NHẤT (history_view) nên user quyền-hẹp vẫn vào
 * được và chỉ thấy tile của mình (critic §2-E).
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { HubLauncher, type HubCategory } from "@/components/workspace";
import {
  Package, Sparkles, Link as LinkIcon, Cpu, FileStack, Award, BookMarked, HeartPulse, ShieldCheck, GitCompare,
} from "lucide-react";

const CATEGORIES: readonly HubCategory[] = [
  {
    key: "define",
    label: "prodHub.define",
    icon: <Package className="h-4 w-4" />,
    tools: [
      { icon: Package, label: "prodHub.products", blurb: "prodHub.productsBlurb", href: "/products", requiredPermission: "settings_products" },
      { icon: Sparkles, label: "prodHub.productOnboarding", blurb: "prodHub.productOnboardingBlurb", href: "/product-onboarding", requiredPermission: "settings_products" },
      { icon: LinkIcon, label: "prodHub.productMapping", blurb: "prodHub.productMappingBlurb", href: "/product-mapping", requiredPermission: "settings_product_mapping" },
      { icon: Cpu, label: "prodHub.componentLibrary", blurb: "prodHub.componentLibraryBlurb", href: "/component-library", requiredPermission: "masterdata" },
      { icon: FileStack, label: "prodHub.recipes", blurb: "prodHub.recipesBlurb", href: "/recipes", requiredPermission: "machine_control", note: "prodHub.recipesNote" },
    ],
  },
  {
    key: "quality",
    label: "prodHub.quality",
    icon: <Award className="h-4 w-4" />,
    tools: [
      { icon: Award, label: "prodHub.goldenSamples", blurb: "prodHub.goldenSamplesBlurb", href: "/golden-samples", requiredPermission: "history_view" },
      { icon: BookMarked, label: "prodHub.defectCatalog", blurb: "prodHub.defectCatalogBlurb", href: "/defect-catalog", requiredPermission: "history_view" },
      { icon: HeartPulse, label: "prodHub.measurementPointHealth", blurb: "prodHub.measurementPointHealthBlurb", href: "/measurement-point-health", requiredPermission: "history_view" },
      { icon: ShieldCheck, label: "prodHub.qualityGateTemplates", blurb: "Quality-gate templates", href: "/quality-gate-templates", requiredPermission: "analytics_spc" },
      { icon: GitCompare, label: "prodHub.productComparison", blurb: "prodHub.productComparisonBlurb", href: "/product-comparison", requiredPermission: "history_view" },
    ],
  },
];

export default function ProductWorkspaceHub() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("productWorkspace.title", "Xưởng sản phẩm")}>
      <HubLauncher categories={CATEGORIES} categoriesLabel={t("productWorkspace.categories", "Nhóm sản phẩm")} />
    </DashboardLayout>
  );
}
