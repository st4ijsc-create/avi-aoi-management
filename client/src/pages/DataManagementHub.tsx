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
    label: "Sản phẩm & Chương trình",
    icon: <Package className="h-4 w-4" />,
    tools: [
      { icon: Package, label: "Model sản phẩm", blurb: "Model · biến thể · điểm đo · spec-limit", href: "/products", requiredPermission: "settings_products" },
      { icon: Sparkles, label: "Wizard tạo sản phẩm", blurb: "Thiết lập sản phẩm đầu-cuối có hướng dẫn", href: "/product-onboarding", requiredPermission: "settings_products" },
      { icon: LinkIcon, label: "Gán sản phẩm ↔ máy", blurb: "Ánh xạ model sản phẩm với máy/trạm", href: "/product-mapping", requiredPermission: "settings_product_mapping" },
      { icon: Cpu, label: "Thư viện linh kiện", blurb: "Package/footprint linh kiện", href: "/component-library", requiredPermission: "masterdata" },
    ],
  },
  {
    key: "masterData",
    label: "Dữ liệu chủ",
    icon: <Tags className="h-4 w-4" />,
    tools: [
      { icon: Tags, label: "Quản lý dữ liệu chủ", blurb: "NCC · vật tư · KH · tay nghề · UoM · lịch…", href: "/master-data", requiredPermission: "masterdata" },
      { icon: Users, label: "Thẻ vận hành viên", blurb: "badgeCode → người dùng", href: "/operator-badges", requiredPermission: "masterdata" },
      { icon: BookOpen, label: "Danh mục chỉ số", blurb: "Semantic layer: định nghĩa KPI có phiên bản + lineage", href: "/metric-catalog", requiredPermission: "machine_status" },
      { icon: History, label: "Nhật ký thay đổi", blurb: "Ai đổi gì, khi nào (chỉ đọc)", href: "/master-data-audit", requiredPermission: "masterdata" },
      { icon: ShieldCheck, label: "Chất lượng dữ liệu", blurb: "Thiếu trường / tham chiếu mồ côi", href: "/data-quality", requiredPermission: "masterdata" },
    ],
  },
  {
    key: "factoryConfig",
    label: "Cấu hình nhà máy & Quản trị",
    icon: <Building2 className="h-4 w-4" />,
    tools: [
      { icon: Database, label: "Cấu hình nhà máy", blurb: "Nhà máy · xưởng · line · trạm · máy · ca · công đoạn", href: "/datasettings", requiredPermission: "settings_factory" },
      { icon: LayoutTemplate, label: "Trạm làm việc", blurb: "Quản lý trạm làm việc", href: "/workstation-management", requiredPermission: "settings_factory" },
      { icon: Workflow, label: "Quy trình", blurb: "Quản lý quy trình sản xuất", href: "/process-management", requiredPermission: "settings_factory" },
      { icon: LayoutTemplate, label: "Sơ đồ bố trí", blurb: "Bố trí mặt bằng nhà máy", href: "/layout", requiredPermission: "settings_factory" },
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
