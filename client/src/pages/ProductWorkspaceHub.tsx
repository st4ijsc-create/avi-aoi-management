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
    label: "Định nghĩa & Thiết lập sản phẩm",
    icon: <Package className="h-4 w-4" />,
    tools: [
      { icon: Package, label: "Model sản phẩm", blurb: "Model · biến thể · điểm đo · spec-limit", href: "/products", requiredPermission: "settings_products" },
      { icon: Sparkles, label: "Wizard tạo sản phẩm", blurb: "Thiết lập sản phẩm đầu-cuối có hướng dẫn", href: "/product-onboarding", requiredPermission: "settings_products" },
      { icon: LinkIcon, label: "Gán sản phẩm ↔ máy", blurb: "Ánh xạ model sản phẩm với máy/trạm", href: "/product-mapping", requiredPermission: "settings_product_mapping" },
      { icon: Cpu, label: "Thư viện linh kiện", blurb: "Package/footprint linh kiện", href: "/component-library", requiredPermission: "masterdata" },
      { icon: FileStack, label: "Recipe máy", blurb: "Công thức chạy máy (kỹ thuật)", href: "/recipes", requiredPermission: "machine_control", note: "Kỹ thuật" },
    ],
  },
  {
    key: "quality",
    label: "Chuẩn vàng & Chất lượng theo sản phẩm",
    icon: <Award className="h-4 w-4" />,
    tools: [
      { icon: Award, label: "Mẫu chuẩn vàng", blurb: "Chụp + duyệt golden sample", href: "/golden-samples", requiredPermission: "history_view" },
      { icon: BookMarked, label: "Danh mục lỗi (IPC-A-610)", blurb: "Catalog phân loại lỗi", href: "/defect-catalog", requiredPermission: "history_view" },
      { icon: HeartPulse, label: "Sức khỏe điểm đo", blurb: "Điểm đo chưa map / mồ côi", href: "/measurement-point-health", requiredPermission: "history_view" },
      { icon: ShieldCheck, label: "Mẫu cổng chất lượng", blurb: "Quality-gate templates", href: "/quality-gate-templates", requiredPermission: "analytics_spc" },
      { icon: GitCompare, label: "So sánh sản phẩm", blurb: "Đối chiếu điểm đo giữa các model", href: "/product-comparison", requiredPermission: "history_view" },
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
