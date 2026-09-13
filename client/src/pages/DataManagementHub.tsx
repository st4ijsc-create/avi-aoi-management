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
import { getAcceptedPermissionsForHref } from "@/lib/navigation";
import {
  Package, Sparkles, Link as LinkIcon, Cpu, Tags, Users, History, ShieldCheck, BookOpen,
  Database, LayoutTemplate, Building2, Workflow,
} from "lucide-react";

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 62 mục A — Ô "Sơ đồ bố trí": HREF VÀ CỔNG QUYỀN LÀ **MỘT BIẾN**
 * ════════════════════════════════════════════════════════════════════════════
 * Lô 5 Mục 2 đã chữa lớp lỗi "một lối vào rồi TỪ CHỐI" một lần (bỏ chuỗi quyền
 * chép tay, hỏi `navGroups`), nhưng nó hỏi về **`/digital-twin`** — một route
 * NAY CHỈ CÒN LÀ REDIRECT. Đích thật của ô này từ Đợt 61 là `/twin-studio`
 * (`App.tsx`: `/layout` → `<Redirect to="/twin-studio" />`), và `/twin-studio`
 * gate bằng `settings_factory` **HOẶC** `machine_control` — không phải
 * `analytics_oee`. Hai cổng rời nhau ⇒ hỏng HAI CHIỀU, đo trên cổng 3062:
 *
 *   · vai chỉ có `analytics_oee`          → THẤY ô, bấm vào **bị TỪ CHỐI**
 *   · `engineer1` (seed THẬT, settings_factory) → VÀO ĐƯỢC, mà **không thấy ô**
 *
 * ⇒ Bản vá không phải "đổi chuỗi quyền cho đúng" (lần sau lại lệch), mà là làm
 *   cho hai thứ ấy **không thể lệch**: href của ô và href dùng để tra quyền là
 *   CÙNG MỘT HẰNG. Và tra bằng `getAcceptedPermissionsForHref` — `/twin-studio`
 *   khai `requiredPermissionAny`, nên hàm một-quyền cũ trả `undefined`, tức
 *   "route không gán quyền": SAI một cách CÂM.
 *
 * ⚠ KHÔNG có fallback chuỗi cứng. Nếu mục nav của `/twin-studio` biến mất, tập
 *   trả về là `[]` và `HubLauncher` **ẩn ô** (fail-closed) thay vì rơi về một
 *   quyền đoán mò — đúng thứ đã đẻ ra chính lỗi này.
 */
const LAYOUT_TILE_HREF = "/twin-studio";
const LAYOUT_TILE_PERMISSION_ANY = getAcceptedPermissionsForHref(LAYOUT_TILE_HREF);

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
      { icon: LayoutTemplate, label: "dataHub.layout", blurb: "dataHub.layoutBlurb", href: LAYOUT_TILE_HREF, requiredPermissionAny: LAYOUT_TILE_PERMISSION_ANY },
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
