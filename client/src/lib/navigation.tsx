import {
  Brush,
  BarChart3,
  History,
  LayoutGrid, 
  Settings, 
  FileText, 
  Package, 
  Building2, 
  TrendingUp, 
  Bell, 
  Users, 
  Link, 
  ClipboardList, 
  Wifi,
  Gauge,
  Factory,
  Database,
  Shield,
  SlidersHorizontal,
  BookOpen,
  Radio,
  AlertTriangle,
  Upload,
  Activity,
  Mail,
  Calendar,
  Server,
  UserCog,
  Boxes,
  LineChart,
  PieChart,
  Target,
  Cog,
  FileBarChart,
  MonitorCheck,
  Tv,
  Workflow,
  Brain,
  Wrench,
  LayoutTemplate,
  Archive,
  Store,
  Timer,
  Tags,
  GitCompare,
  GitMerge,
  Map,
  MapPin,
  Bug,
  Grid3X3,
  Sparkles,
  Search,
  MessageSquare,
  LayoutDashboard,
  Camera,
  Presentation,
  ClipboardCheck,
  ScrollText,
  CalendarClock,
  HardDrive,
  Warehouse,
  GitBranch,
  Cpu,
  Code2,
  FileCode2,
  Layers,
  Clock,
  Lock,
  KeyRound,
  ShieldCheck,
  GraduationCap,
  Leaf,
  Plug,
  FlaskConical,
  ShieldAlert,
  ShieldQuestion,
  Zap,
  User,
  Monitor,
  Inbox,
  Sun,
  Bot,
  Network,
  Globe,
  Share2,
  FolderSearch,
  Star,
  Repeat,
  Waypoints,
  FileStack,
} from "lucide-react";
import { ReactNode } from "react";

/**
 * Menu "tier" (doc 22 P4 — Simple vs Advanced mode).
 *   - `simple`   → everyday surface shown to non-technical roles by default.
 *   - `advanced` → engineering-heavy surface hidden behind the Advanced toggle.
 * Untagged items/groups are treated as `simple` (visible in both modes) so nothing
 * is ever hidden by accident — tagging is opt-IN to advanced-only.
 */
export type NavTier = 'simple' | 'advanced';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: string | number;
  description?: string;
  /**
   * Role gate. A single role (legacy, e.g. `'admin'`) or a role-set (doc69 Wave 0-C —
   * e.g. `['admin', 'engineer']`) — any role in the set is admitted. `isItemAccessible`
   * normalizes both shapes; admin always bypasses regardless of this field.
   */
  requiredRole?: string | string[];
  /** Module permission name required to view this item (checked via canView) */
  requiredPermission?: string;
  /** Permission category this item belongs to */
  permissionCategory?: string;
  /** Cấp-2 section key; items sharing a key are grouped under one sub-header (i18n nav.section.<key>) */
  section?: string;
  /**
   * Menu tier (doc 22 P4). `advanced` → engineering-only; hidden in Simple mode.
   * Absent → simple (always visible).
   */
  tier?: NavTier;
  /**
   * i18n key for a plain-language tooltip explaining an insider acronym/term
   * (FOE, UNS, PackML, …). Rendered as a hover title + a subtitle in flyouts.
   */
  hint?: string;
  /** Marks an engineer-oriented item (used to visually flag jargon rows). */
  engineerOriented?: boolean;
  /**
   * Framework/flag-gated page that is not live yet → renders a small "Beta /
   * Cần thiết lập" badge in the nav and a banner on the page so users don't hit
   * a dead end expecting live data.
   */
  beta?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  icon?: ReactNode;
  items: NavItem[];
  defaultOpen?: boolean;
  description?: string;
  requiredRole?: 'admin' | 'user';
  /** Permission category that controls group visibility */
  permissionCategory?: string;
  /** Ordered Cấp-2 sections for this group; absent → render flat (no sub-headers) */
  sections?: { key: string; label: string }[];
  /**
   * Menu tier (doc 22 P4). `advanced` groups (Devices & OT, AI ops internals,
   * Federation lives under Admin) are hidden in Simple mode. Absent → simple.
   */
  tier?: NavTier;
}

/**
 * Navigation structure — role-aware 8-group IA (doc 12 §7).
 *
 * The sidebar is reorganized into 8 top-level groups by the work people actually
 * do (Overview · Production · Quality · Devices & OT · Analytics · AI · Admin ·
 * Me). Every leaf maps to an EXISTING route. Group + item visibility is filtered
 * by role/permission via getFilteredNavGroups (admin sees all; each group hides
 * when none of its items are visible).
 *
 * Read-open everywhere (no permission gate so EVERY authenticated role — including
 * viewer/user — can reach them): the AI Workspace (chat / inbox / today / copilot)
 * and the personal "Me" group. This implements doc 12 §7's rule that chat/inbox/
 * today are read-open for all roles (fixes P-F8 — decoupled from
 * analytics_ai_performance). The pages themselves still enforce their own RBAC.
 *
 * Labels/descriptions are i18n keys (nav.*); consumers call t(item.label).
 */
export const navGroups: NavGroup[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // 1. OVERVIEW — doc 67 W5 (quyết định #1a): rút 9 mục chồng lấp còn 4 cửa rõ vai:
  //    (1) /control-tower "Tổng quan nhà máy" — landing chính · (2) /ops-console
  //    "Xử lý cảnh báo" · (3) /andon "Bảng Andon (TV)" · (4) /drill-down "Phân tích
  //    tập đoàn". Các mục /command-center · /dashboard · /corporate-dashboard ·
  //    /executive VẪN NẰM TRONG navGroups (RouteGuard navHref + breadcrumb + ⌘K
  //    cần item tồn tại) nhưng bị ẨN khỏi rail qua COLLAPSED_INTO_HUB — truy cập
  //    qua RelatedViews / deep-link / ⌘K. /dashboard-center DỜI sang group Admin.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "overview",
    label: "nav.overviewGroup",
    icon: <Gauge className="h-4 w-4" />,
    description: "nav.overviewGroupDesc",
    defaultOpen: true,
    permissionCategory: "dashboard",
    // doc 68 §2 (Navbar Phương án B) — landing /control-tower (không section, leading
    // bucket) + 2 sub-nhóm có tiêu đề: "Bảng tổng hợp" (dashboards) · "Vận hành" (ops).
    sections: [
      { key: "dashboards", label: "nav.section.overviewDashboards" },
      { key: "ops", label: "nav.section.overviewOps" },
    ],
    items: [
      {
        // doc 67 W5 — "Tổng quan nhà máy": landing chính của group, tab tự chọn theo
        // vai (Điều hành/Quản đốc/Vận hành), cross-link ra các màn chuyên sâu.
        // doc 68 §2: KHÔNG gắn section + đứng đầu mảng → leading landing (không header).
        href: "/control-tower",
        label: "nav.controlTower",
        icon: <LayoutDashboard className="h-4 w-4" />,
        description: "Tổng quan nhà máy 1-cửa theo vai trò: OEE/andon/kế hoạch/AI · liên kết ra các màn chuyên sâu",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
      // ── Bảng tổng hợp (dashboards) ──
      {
        // doc 67 W5: đổi tên "Chất lượng sản xuất" (dashboard chất lượng/KPI sản xuất).
        href: "/dashboard",
        label: "nav.dashboardMain",
        icon: <BarChart3 className="h-4 w-4" />,
        description: "nav.dashboardMainDesc",
        requiredPermission: "dashboard_view",
        permissionCategory: "dashboard",
        section: "dashboards",
      },
      {
        href: "/drill-down",
        label: "nav.drillDown",
        icon: <TrendingUp className="h-4 w-4" />,
        description: "nav.drillDownDesc",
        requiredPermission: "dashboard_drilldown",
        permissionCategory: "dashboard",
        section: "dashboards",
      },
      {
        href: "/corporate-dashboard",
        label: "nav.corporateDashboard",
        icon: <Building2 className="h-4 w-4" />,
        description: "nav.corporateDashboardDesc",
        requiredPermission: "dashboard_corporate",
        permissionCategory: "dashboard",
        section: "dashboards",
      },
      {
        // doc 46 FE-W3.5 (D5) — Executive mobile/PWA: OEE/KPI briefing + AI summary +
        // duyệt nhanh, tối ưu điện thoại (cài PWA). doc 67 W5: "Bản tin điều hành".
        href: "/executive",
        label: "nav.executiveMobile",
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "Bản tin điều hành gọn cho điện thoại: OEE/KPI · tóm tắt AI · phê duyệt chờ · cài như app (PWA)",
        requiredPermission: "dashboard_corporate",
        permissionCategory: "dashboard",
        section: "dashboards",
      },
      // ── Vận hành (ops) ──
      {
        // P1: unified War-Room / Ops Console (consolidates Andon + Predictive + alerts).
        href: "/ops-console",
        label: "nav.opsConsole",
        icon: <AlertTriangle className="h-4 w-4" />,
        description: "nav.opsConsoleDesc",
        requiredPermission: "andon",
        permissionCategory: "andon",
        section: "ops",
      },
      {
        // W5-C (doc 27 F7): dedicated Andon/TV wall board (huge type, auto-cycle,
        // socket-first). Gated like the main dashboard — it is a read-only surface.
        href: "/andon",
        label: "nav.andonBoard",
        icon: <Tv className="h-4 w-4" />,
        description: "nav.andonBoardDesc",
        requiredPermission: "dashboard_view",
        permissionCategory: "dashboard",
        section: "ops",
      },
      {
        // U2 (doc 21 §6 G-3) — sơ đồ + twin + KPI strip + alarm rail. doc 67 W5:
        // đổi tên "Sơ đồ & bản sao số"; vào từ RelatedViews của Tổng quan nhà máy.
        href: "/command-center",
        label: "nav.commandCenter",
        icon: <Gauge className="h-4 w-4" />,
        description: "nav.commandCenterDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "ops",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 2. PRODUCTION — MES (control tower / WIP / trace / twin) · Inspection
  //    (history / AOI packages) · Orders / Schedule / Sessions · BOM.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "production",
    label: "nav.productionGroup",
    icon: <Factory className="h-4 w-4" />,
    description: "nav.productionGroupDesc",
    defaultOpen: false,
    permissionCategory: "production",
    sections: [
      { key: "mes", label: "nav.section.mes" },
      { key: "inspection", label: "nav.section.inspection" },
      { key: "ordersSchedule", label: "nav.section.ordersSchedule" },
      { key: "bom", label: "nav.section.bom" },
    ],
    items: [
      {
        href: "/production-dashboard",
        label: "nav.productionDashboard",
        icon: <Gauge className="h-4 w-4" />,
        description: "nav.productionDashboardDesc",
        requiredPermission: "dashboard_view",
        permissionCategory: "dashboard",
        section: "mes",
      },
      {
        // doc 40 Wave 4c §11 — War-room "Giao ban 7h": one-pager giao ban theo ca
        // (KPI + OEE theo Line + top downtime + so sánh ca + kế hoạch vs thực tế).
        // Công cụ giao ban cốt lõi của quản đốc/quản lý → tier simple. Nhãn tiếng Việt
        // trực tiếp (i18n key hoãn sang đợt i18n — theo tiền lệ Feeder/ECN/NCR).
        href: "/war-room",
        label: "nav.warRoom",
        icon: <Presentation className="h-4 w-4" />,
        description: "Bảng giao ban theo ca: OEE theo Line · top máy dừng · so sánh ca · kế hoạch vs thực tế",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "mes",
        tier: "simple",
      },
      {
        // doc 46 FE-W2 — SLA Cockpit: MTTA/MTTR + escalation-breach cho Andon/cảnh báo
        // (companion của Alarm KPI). MTTA/MTTR = trpc.andon.metrics (backend-aggregated);
        // breach/breakdown tính từ andon.list. Nhãn trực tiếp (i18n key hoãn — theo tiền lệ War-room).
        href: "/sla-cockpit",
        label: "nav.slaCockpit",
        icon: <Gauge className="h-4 w-4" />,
        description: "SLA cảnh báo/Andon: thời gian tiếp nhận (MTTA) · khắc phục (MTTR) · vi phạm leo thang · quá hạn",
        // Gate = /andon board (dashboard_view) → cùng đối tượng có andon/canView (supervisor/operator);
        // maintenance thiếu andon/canView sẽ thấy trạng thái rỗng trung thực (giống andon board).
        requiredPermission: "dashboard_view",
        permissionCategory: "dashboard",
        section: "mes",
        tier: "simple",
      },
      {
        // doc 40 Wave 4 — Đổi sản phẩm (changeover) tại line: operator quét sản phẩm
        // mới → kiểm tra readiness/mapping máy/feeder → xác nhận đổi. Công cụ vận hành
        // cốt lõi tại line → tier simple. Gate machine_status (operator/maintenance đều
        // có). Nhãn tiếng Việt trực tiếp (i18n key hoãn — theo tiền lệ Feeder/ECN/NCR).
        href: "/product-changeover",
        label: "Đổi sản phẩm",
        icon: <Repeat className="h-4 w-4" />,
        description: "Trình đổi sản phẩm tại line: quét mã → kiểm tra readiness · ánh xạ máy · feeder → xác nhận",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "mes",
        tier: "simple",
      },
      {
        href: "/mes-control-tower",
        label: "nav.mesControlTower",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.mesControlTowerDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "mes",
      },
      {
        href: "/wip-dashboard",
        label: "nav.wipDashboard",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.wipDashboardDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "mes",
      },
      {
        href: "/traceability",
        label: "nav.traceability",
        icon: <GitMerge className="h-4 w-4" />,
        description: "nav.traceabilityDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "mes",
      },
      {
        href: "/digital-twin",
        label: "nav.digitalTwin",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.digitalTwinDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "mes",
      },
      {
        href: "/history",
        label: "nav.historyPage",
        icon: <History className="h-4 w-4" />,
        description: "nav.historyPageDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
        section: "inspection",
      },
      {
        href: "/aoi-packages",
        label: "nav.aoiPackages",
        icon: <Camera className="h-4 w-4" />,
        description: "nav.aoiPackagesDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
        section: "inspection",
      },
      {
        // W3-A (doc 35 F2): surface orphan /product-comparison — cross-model
        // measurement-point diff tool. Gated history_view like its inspection siblings.
        href: "/product-comparison",
        label: "products.comparison",
        icon: <GitCompare className="h-4 w-4" />,
        description: "products.comparisonDescription",
        requiredPermission: "history_view",
        permissionCategory: "history",
        section: "inspection",
      },
      {
        href: "/production-orders",
        label: "nav.productionOrdersPage",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "nav.productionOrdersDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
        section: "ordersSchedule",
      },
      {
        href: "/production-scheduling",
        label: "nav.productionScheduling",
        icon: <Timer className="h-4 w-4" />,
        description: "nav.productionSchedulingDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
        section: "ordersSchedule",
      },
      {
        href: "/production-signoff",
        label: "nav.productionSignoff",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.productionSignoffDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
        section: "ordersSchedule",
      },
      {
        href: "/history-export-scheduling",
        label: "nav.exportSchedule",
        icon: <Calendar className="h-4 w-4" />,
        description: "nav.exportScheduleDesc",
        requiredPermission: "reports_schedule",
        permissionCategory: "reports",
        section: "ordersSchedule",
      },
      {
        // doc 35 W4-E — routing master (ISA-95). doc 41 IA cleanup — DỜI từ module
        // Thiết bị (section maintenance sai ngữ nghĩa) về ĐÂY: định tuyến công đoạn
        // theo sản phẩm là MES/kế hoạch, thuộc "Đơn hàng & Lịch".
        href: "/routing-master",
        label: "nav.routingMaster",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "Routing master ISA-95: chuỗi công đoạn theo sản phẩm — nguồn ERP resolve operations",
        requiredPermission: "production_orders",
        permissionCategory: "production_orders",
        section: "ordersSchedule",
      },
      {
        href: "/bom-management",
        label: "nav.bomManagement",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.bomManagementDesc",
        requiredPermission: "mes_bom",
        permissionCategory: "mes_bom",
        section: "bom",
      },
      {
        // doc 35 W4-C — feeder/MSD/stencil scan-verify. doc 41 IA cleanup — DỜI từ
        // module Thiết bị (section maintenance sai ngữ nghĩa) về ĐÂY: quản lý vật tư
        // tại line (feeder/MSD/stencil) thuộc BOM & Máng cấp, không phải bảo trì máy.
        href: "/feeder-verify",
        label: "nav.materialsAtLine",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "Feeder scan-verify (chống gắn nhầm) · MSD floor-life (J-STD-020) · stencil cycle counter",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "bom",
        tier: "simple", // doc 40 — cốt lõi operator tại line, hiện trong Simple mode
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 3. QUALITY — Quality Cockpit (Home · Gates · Templates · SPC · Pareto ·
  //    Heatmap · Annotation). Landing for quality_inspector.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "quality",
    label: "nav.qualityGroup",
    icon: <ClipboardCheck className="h-4 w-4" />,
    description: "nav.qualityGroupDesc",
    defaultOpen: false,
    permissionCategory: "history",
    // doc 36 W2 — "bóc" Quality Cockpit's in-page tabs out as deep-link menu entries.
    sections: [{ key: "cockpit", label: "nav.section.cockpit" }],
    items: [
      {
        // P3-W2: flagship Quality Cockpit — default QUALITY landing. SPC / Pareto /
        // Heatmap / Gates / Annotation now live as tabs here (legacy routes redirect in).
        href: "/quality-cockpit",
        label: "nav.qualityCockpit",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.qualityCockpitDesc",
        requiredPermission: "analytics_spc",
        permissionCategory: "analytics",
      },
      {
        href: "/quality-home",
        label: "nav.qualityHome",
        icon: <ClipboardCheck className="h-4 w-4" />,
        description: "nav.qualityHomeDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
      },
      {
        href: "/quality-gate-templates",
        label: "nav.qualityGateTemplates",
        icon: <LayoutTemplate className="h-4 w-4" />,
        description: "nav.qualityGateTemplatesDesc",
        requiredPermission: "analytics_spc",
        permissionCategory: "analytics",
      },
      {
        // KEEP — factory-layout defect heatmap (distinct from the cockpit product heatmap tab).
        href: "/defect-heatmap",
        label: "nav.defectHeatmap",
        icon: <Map className="h-4 w-4" />,
        description: "nav.defectHeatmapDesc",
        requiredPermission: "analytics_defect_heatmap",
        permissionCategory: "analytics",
      },
      {
        // W7-C (doc 27 V8/V11) — golden-sample capture + approval + align/diff management.
        href: "/golden-samples",
        label: "nav.goldenSamples",
        icon: <Star className="h-4 w-4" />,
        description: "nav.goldenSamplesDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
      },
      {
        // W8-C (doc 27 V10) — dedicated repair workstation: scan serial → repair walk → re-inspect.
        href: "/repair-station",
        label: "nav.repairStation",
        icon: <Wrench className="h-4 w-4" />,
        description: "nav.repairStationDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
      },
      {
        // Doc 31 Đợt B (OP4) — IPC-A-610 defect catalog curation + unmatched codes + repair guidance.
        href: "/defect-catalog",
        label: "nav.defectCatalog",
        icon: <Bug className="h-4 w-4" />,
        description: "nav.defectCatalogDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
      },
      {
        // Doc 31 Đợt B (MP3) — __UNMAPPED__ unmatched-rate metric + bulk remap tool.
        href: "/measurement-point-health",
        label: "nav.measurementPointHealth",
        icon: <MapPin className="h-4 w-4" />,
        description: "nav.measurementPointHealthDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
        tier: "advanced",
      },
      // doc 39 — Quality Cockpit ?tab= deep-link rows removed (redundant with the
      // cockpit's own in-page tabs). The plain /quality-cockpit entry above is the
      // single menu row; SPC / Pareto / Heatmap / Gates / Annotation are tabs inside.
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4. DEVICES & MONITORING — realtime status/health · device adapters / edge /
  //    MQTT telemetry · onboarding · Maintenance. Landing for maintenance.
  //    (F2 doc 23 §5 E2: the engineering/control + automation surface split out
  //    into its own `engineering` module below to relieve this over-loaded group.)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "devices",
    label: "nav.devicesGroup",
    icon: <Cpu className="h-4 w-4" />,
    description: "nav.devicesGroupDesc",
    defaultOpen: false,
    permissionCategory: "machine_monitoring",
    // doc 22 P4 — engineering-heavy module: hidden in Simple mode.
    tier: "advanced",
    // doc 41 (2026-07-11) IA cleanup — 4 section rõ nghĩa thay 4 section cũ lệch
    // ngữ nghĩa: gộp telemetry(1-mục) + onboarding thành "connect" (Kết nối & Cài
    // máy), TÁCH các surface điều-khiển-runtime (robot/control-plane/edge) ra
    // "control" (Điều khiển thiết bị), dồn "Quản lý thiết bị" về cạnh "Đăng ký
    // máy" (bỏ khỏi maintenance), và đẩy routing/feeder (MES/vật tư) sang module
    // Sản xuất. maintenance chỉ còn bảo trì thật + cảnh báo.
    sections: [
      { key: "monitoring", label: "nav.section.monitoring" },
      { key: "connect", label: "nav.section.connect" },
      { key: "control", label: "nav.section.control" },
      { key: "maintenance", label: "nav.section.maintenance" },
    ],
    items: [
      // — Status & health —
      {
        // doc 40 Wave 4d §13.1 — Factory Command View: màn hình chỉ huy TOÀN nhà máy
        // (sơ đồ 2D/3D theo Line, click máy → drawer chi tiết + rail "vấn đề đang mở").
        // Landing giám sát cho supervisor/manager. Giữ tier "simple" (công cụ chỉ huy
        // cốt lõi) dù nhóm devices là advanced.
        // Nhãn tiếng Việt trực tiếp (i18n key hoãn sang đợt i18n; locale ngoài phạm vi
        // sở hữu của agent này) — theo tiền lệ Feeder/ECN/NCR trong file này.
        href: "/factory-command",
        label: "Chỉ huy nhà máy",
        icon: <Factory className="h-4 w-4" />,
        description: "Sơ đồ 2D/3D toàn nhà máy theo Line · click máy xem chi tiết · vấn đề đang mở",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
        tier: "simple",
      },
      {
        // doc 44 W3-B4 §G5.10 — Line View (SYNAPSE LDS-L5 Ch.4.2): sơ đồ tuyến +
        // FSM 7 trạng thái + readiness + lệnh tuyến (ConfirmWithReason → lineController.
        // command, server actuationProcedure). Xem = machine_status (vận hành/kỹ sư);
        // lệnh tự gate machine_control/edit trong trang. Công cụ vận hành tại tuyến →
        // tier simple (như /factory-command).
        href: "/line-view",
        label: "lineView.title",
        icon: <Waypoints className="h-4 w-4" />,
        description: "lineView.navDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
        tier: "simple",
      },
      {
        // P3-W2: unified Device Monitor — default DEVICES & OT landing (machines +
        // OT adapters + edge nodes in one live table; legacy /machine-status redirects here).
        href: "/device-monitor",
        label: "nav.deviceMonitor",
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.deviceMonitorDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
        // doc 40 Lan — công cụ cốt lõi của operator/maintenance: giữ hiện trong Simple
        // mode dù nhóm "devices" là advanced (xem filterNavGroupsByMode).
        tier: "simple",
      },
      // doc 36 follow-up — /machine-health REMOVED: it redirects into /device-monitor
      // (Health tab); the hub row above is the single entry point.
      {
        href: "/oee-dashboard",
        label: "nav.oeeDashboard",
        icon: <Timer className="h-4 w-4" />,
        description: "nav.oeeDashboardDesc",
        // QA4F-1: OEE giờ là tab giám sát trong DeviceHub (redirect /oee-dashboard →
        // /device-monitor?tab=oee, hub gate machine_monitoring). Đồng bộ gate về
        // machine_status (OEE là KPI giám sát máy) thay analytics_oee để hết lệch quyền.
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
      },
      // doc 36 follow-up — /factory-live-map + /digital-twin-center REMOVED: both
      // redirect into the canonical /digital-twin hub (Production group). /field-devices
      // REMOVED: redirects into /device-monitor (Field tab). Tabs reachable in the hubs.
      {
        // Tier-1b (doc 24): read-only system health — OT store-and-forward buffer +
        // connection HA supervisors + DINOv2 model tier (+ commissioning ledger &
        // twin export). View on machine_monitoring.
        href: "/system-health",
        label: "nav.systemHealth",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.systemHealthDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
        engineerOriented: true,
      },
      {
        // doc 56 Đ3/Đ5 — process-result analytics (pass/fail + SPC I-MR + fleet FPY)
        // cho máy automation/IoT. Cùng thân với tab "Kết quả process" của MachineCockpit.
        // (doc 59 QW: đưa surface đã-xây-nhưng-ẩn vào menu.)
        href: "/process-analytics",
        label: "nav.processAnalytics",
        icon: <LineChart className="h-4 w-4" />,
        description: "nav.processAnalyticsDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
        engineerOriented: true,
      },
      // — Kết nối & Cài máy (section "connect") —
      // doc 36 follow-up — the 9 legacy MQTT/UNS rows now all <Redirect> into the
      // unified /connectivity hub. ONE hub row only; every surface (overview / devices /
      // topics / bulletin / replay / alerts / ng-rate / uns / profiles) is a TAB inside
      // the hub — no ?tab= deep-link rows in the menu (doc 39: tab-switcher menus removed).
      {
        // doc 56 Đ2b — wizard đăng ký HỢP NHẤT 3 nhánh (aoi_avi / automation / iot):
        // cửa thêm-thiết-bị thống nhất (Cụm C sẽ redirect các wizard cũ vào đây). Trang
        // tự gate cờ VITE_DEVICE_ONBOARD_WIZARD_V2_ENABLED bên trong. (doc 59 QW.)
        href: "/device-onboarding",
        label: "nav.deviceOnboarding",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.deviceOnboardingDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "connect",
      },
      // doc 59 Cụm C — /machine-onboarding + /aoi-onboarding GỠ khỏi menu: đã hợp nhất
      // vào "Thêm thiết bị (hợp nhất)" /device-onboarding (mục ở trên). Route cũ redirect
      // vào đó (App.tsx, gate cờ wizard); deep-link vẫn sống.
      {
        href: "/machine-registration",
        label: "nav.machineRegistration",
        icon: <Plug className="h-4 w-4" />,
        description: "nav.machineRegistrationDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "connect",
      },
      {
        // doc 41 IA cleanup — "Quản lý thiết bị" (device-management tab của
        // /monitoring-setting) DỜI từ section maintenance về ĐÂY, ngay cạnh "Đăng ký
        // máy": cùng một chức năng quản lý/đăng ký thiết bị, không phải bảo trì. Hết
        // cảnh "1 chức năng nằm rải 2-3 section".
        href: "/monitoring-setting?tab=device-management",
        label: "monitoringSettings.sidebar.deviceManagement",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.monitoringSettingDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "connect",
      },
      {
        href: "/device-adapters",
        label: "nav.deviceAdapters",
        icon: <Plug className="h-4 w-4" />,
        description: "nav.deviceAdaptersDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "connect",
      },
      // doc 36 follow-up — /uns-mapping REMOVED: redirects into /connectivity (UNS tab).
      {
        // Doc 27 C1 (W2-A): AOI/AVI hot-folder file-drop ingestion (CONFIG + status + dry-run)
        href: "/hot-folders",
        label: "nav.hotFolders",
        icon: <FolderSearch className="h-4 w-4" />,
        description: "nav.hotFoldersDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "connect",
      },
      {
        href: "/connectivity",
        label: "nav.connectivity",
        icon: <Radio className="h-4 w-4" />,
        description: "nav.mqttDashboardDesc",
        requiredPermission: "mqtt_monitoring",
        permissionCategory: "mqtt",
        section: "connect",
      },
      // — Điều khiển thiết bị (section "control") — runtime control surfaces —
      {
        href: "/edge-nodes",
        label: "nav.edgeNodes",
        icon: <Cpu className="h-4 w-4" />,
        description: "nav.edgeNodesDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "control",
      },
      {
        // P4-D: robot/AGV registry + telemetry + job log (read-mostly; motion via HITL dispatcher)
        href: "/robot-control",
        label: "nav.robotControl",
        icon: <Bot className="h-4 w-4" />,
        description: "nav.robotControlDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "control",
      },
      {
        // P4-D: Factory Control Plane (equipment capability/PackML + FOE + edge runtime, read-only)
        href: "/control-plane",
        label: "nav.controlPlane",
        icon: <Network className="h-4 w-4" />,
        description: "nav.controlPlaneDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "control",
        hint: "nav.hint.controlPlane",
        engineerOriented: true,
        beta: true,
      },
      // — Maintenance / predictive —
      {
        // doc 59 Cụm I — Trung tâm bảo trì: hub-launcher (work-order · CMMS · copilot).
        href: "/maintenance-hub",
        label: "Trung tâm bảo trì",
        icon: <Wrench className="h-4 w-4" />,
        description: "Một cửa cho bảo trì: lệnh công việc · CMMS/độ tin cậy · copilot",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "maintenance",
        tier: "simple",
      },
      {
        href: "/technician-copilot",
        label: "nav.technicianCopilot",
        icon: <Wrench className="h-4 w-4" />,
        description: "nav.technicianCopilotDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "maintenance",
        tier: "simple", // doc 40 — cốt lõi maintenance, hiện trong Simple mode
      },
      {
        href: "/work-orders",
        label: "nav.workOrders",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "nav.workOrdersDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "maintenance",
        tier: "simple", // doc 40 — cốt lõi maintenance, hiện trong Simple mode
      },
      {
        // doc 40 Wave 4c §11 — CMMS hub: lịch bảo trì phòng ngừa (maintenance_schedules)
        // + phụ tùng/độ tin cậy (MTTR/MTBF). Gate machine_control (bảo trì có mutation).
        // Nhãn tiếng Việt trực tiếp (i18n key hoãn — theo tiền lệ Feeder/ECN/NCR).
        href: "/cmms",
        label: "Bảo trì (CMMS)",
        icon: <Wrench className="h-4 w-4" />,
        description: "Lịch bảo trì phòng ngừa · phụ tùng & độ tin cậy (MTTR/MTBF)",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "maintenance",
        tier: "simple",
      },
      // doc 41 IA cleanup — /feeder-verify (vật tư tại line) DỜI sang module Sản
      // xuất §bom, /routing-master (định tuyến ISA-95) DỜI sang §ordersSchedule:
      // cả hai thuộc MES/vật tư, không phải "Bảo trì thiết bị".
      {
        href: "/alerts",
        label: "nav.alertsList",
        icon: <Bell className="h-4 w-4" />,
        description: "nav.alertsListDesc",
        // doc 40 Lan — trước gate `mqtt_alerts` (operator/maintenance không có) → không
        // thấy danh sách cảnh báo. Đổi sang `machine_status` (cả 2 role đều có canView).
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "maintenance",
        tier: "simple", // doc 40 — cốt lõi operator/maintenance, hiện trong Simple mode
      },
      // doc 36 follow-up — /mqtt-alerts (Alert Rules) REMOVED: redirects into
      // /connectivity (Alerts tab); surfaced as "/connectivity?tab=alerts" in the hub.
      // (/alerts — the read-only alerts LIST — stays; it is not part of the hub.)
      // doc 41 IA cleanup — "Quản lý thiết bị" (/monitoring-setting?tab=device-management)
      // DỜI lên section "connect" (cạnh Đăng ký máy); không còn ở maintenance.
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4b. ENGINEERING & CONTROL (ADVANCED) — the programming / interlock / recipe
  //     surface + the Automation-Orchestration cockpits (fleet · safety · standards
  //     · integration · twin/RF · IR editor · floor editor) split out of Devices
  //     (F2 doc 23 §5 E2). Advanced-tier; every item keeps its ORIGINAL href /
  //     icon / permission / tier / hint / beta verbatim — regrouped only. Gating is
  //     inherited from the items (machine_control / machine_monitoring / interlock),
  //     so this group respects the same role/permission filtering as its pages.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "engineering",
    label: "nav.engineeringGroup",
    icon: <Code2 className="h-4 w-4" />,
    description: "nav.engineeringGroupDesc",
    defaultOpen: false,
    permissionCategory: "machine_monitoring",
    // doc 22 P4 — engineering-heavy module: hidden in Simple mode.
    tier: "advanced",
    // W6-26 (doc 25 T8) — mục phẳng → SECTION con theo tác vụ.
    // U15 (doc 26 §3.1) — tách "safetyStandards" (quá tải, trộn ngữ nghĩa) thành
    // "safety" (An toàn: interlock + workforce) và "standardsIntegration"
    // (Chuẩn hoá & Tích hợp: equipment-standards + equipment-integration). Hub
    // /engineering-home KHÔNG thuộc section nào (đọc như landing, nổi đầu nhóm).
    sections: [
      { key: "authoring", label: "nav.section.authoring" },
      { key: "orchestration", label: "nav.section.orchestration" },
      { key: "safety", label: "nav.section.safety" },
      { key: "standardsIntegration", label: "nav.section.standardsIntegration" },
      { key: "twin", label: "nav.section.twin" },
    ],
    items: [
      // — Engineering Hub — hub-and-spoke front door (items[0] → breadcrumb /
      // role-home / BottomNav trỏ vào hub thay vì mở thẳng IDE). Giữ tối thiểu
      // machine_monitoring như group để ai thấy nhóm đều mở được hub.
      // U15 (doc 26 §3.1) — KHÔNG gán section: hub là landing của cả nhóm, không
      // thuộc "authoring"; groupItemsBySection nổi mục sectionless đầu nhóm lên đầu.
      {
        href: "/engineering-home",
        label: "nav.engineeringHome",
        icon: <LayoutDashboard className="h-4 w-4" />,
        description: "nav.engineeringHomeDesc",
        // doc 40 QA-1b: hub Kỹ thuật là surface control → machine_control (engineer/
        // supervisor/admin), KHÔNG để viewer/operator xem qua alias machine_status.
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      {
        // doc 59 cụm phụ — Engineering Studio: launcher danh mục (soạn thảo/điều phối/
        // an toàn/chuẩn-hoá). Song song /engineering-home (landing tác vụ). Per-tile RBAC.
        href: "/engineering-studio",
        label: "Xưởng kỹ thuật",
        icon: <FlaskConical className="h-4 w-4" />,
        description: "Soạn thảo · điều phối · an toàn · chuẩn hoá — một danh mục",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      // — Authoring & Programming —
      {
        href: "/engineering",
        label: "nav.engineeringWorkspace",
        icon: <Code2 className="h-4 w-4" />,
        description: "nav.engineeringWorkspaceDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "authoring",
        hint: "nav.hint.engineeringWorkspace",
        engineerOriented: true,
      },
      {
        // doc 35 W4-D — plain labels (i18n keys deferred to the i18n polish pass)
        href: "/engineering-changes",
        label: "Thay đổi kỹ thuật (ECN)",
        icon: <GitCompare className="h-4 w-4" />,
        description: "Phiếu thay đổi kỹ thuật: yêu cầu → phân tích tác động → duyệt (SoD) → hiệu lực; + backfill componentCode",
        // doc 54 Đ2 — ECN là tác vụ kỹ thuật: gate theo machine_control (engineer có)
        // thay masterdata (kỹ sư không có → trước bị Access Denied). SoD vẫn ở service.
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "authoring",
        engineerOriented: true,
      },
      {
        href: "/recipes",
        label: "nav.recipes",
        icon: <FlaskConical className="h-4 w-4" />,
        description: "nav.recipesDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "authoring",
      },
      {
        href: "/interlock-rules",
        label: "nav.interlockRules",
        icon: <ShieldAlert className="h-4 w-4" />,
        description: "nav.interlockRulesDesc",
        requiredPermission: "interlock",
        permissionCategory: "interlock",
        section: "safety",
        hint: "nav.hint.interlockRules",
        engineerOriented: true,
      },
      {
        href: "/orchestration-studio",
        label: "nav.orchestrationStudio",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.orchestrationStudioDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "orchestration",
        hint: "nav.hint.orchestrationStudio",
        engineerOriented: true,
        beta: true,
      },
      {
        // D1 (doc 16 §11.1 Khối 6) — Visual IR Editor: author motion/IO device
        // programs as first-class IR blocks, lint + transpile preview. Read-open
        // (machine_monitoring); save/build gated by DPC_IR_V2_ENABLED + machine_control.
        href: "/ir-editor",
        label: "nav.irEditor",
        icon: <Code2 className="h-4 w-4" />,
        description: "nav.irEditorDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "authoring",
        hint: "nav.hint.irEditor",
        engineerOriented: true,
        beta: true,
      },
      {
        // P4 (doc 24 Wave-3) — IEC 61131 POU Studio: structured LAD/FBD/SFC POUs with
        // PLCopen TC6 XML import/export, semantic lint, and transpile-to-ST preview.
        // Read-open (machine_monitoring); all pure previews (open runtime only, no device path).
        href: "/pou-studio",
        label: "nav.pouStudio",
        icon: <FileCode2 className="h-4 w-4" />,
        description: "nav.pouStudioDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "authoring",
        hint: "nav.hint.pouStudio",
        engineerOriented: true,
        beta: true,
      },
      {
        // Doc 34 · P3 — Programming Copilot. doc 41: đây là NHÀ DUY NHẤT còn lại (entry
        // trùng ở nhóm AI đã gỡ). Vai trò trang này = "scratchpad" sinh code nhanh khi
        // CHƯA mở project; còn khi soạn trong editor, copilot hiện diện dạng dock nhúng
        // (ProgrammingCopilotDock) ngay trong Engineering Workspace / IR / POU.
        href: "/programming-copilot",
        label: "nav.programmingCopilot",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.programmingCopilotDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "authoring",
        hint: "nav.hint.programmingCopilot",
        engineerOriented: true,
      },
      {
        // Automation Orchestration (Khối 2) — fleet task allocation, zones/traffic,
        // skill/resource/charging. Read-mostly cockpit gated on machine_monitoring.
        href: "/fleet-orchestration",
        label: "nav.fleetOrchestration",
        icon: <Bot className="h-4 w-4" />,
        description: "nav.fleetOrchestrationDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "orchestration",
        hint: "nav.hint.fleetOrchestration",
        engineerOriented: true,
        beta: true,
      },
      {
        // Automation Orchestration (Khối 3) — advisory safety cockpit + workforce
        // board (safety-adjacent, next to interlock rules). View-only.
        href: "/safety-workforce",
        label: "nav.safetyWorkforce",
        icon: <ShieldQuestion className="h-4 w-4" />,
        description: "nav.safetyWorkforceDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "safety",
        hint: "nav.hint.safetyWorkforce",
        engineerOriented: true,
        beta: true,
      },
      {
        // Automation Orchestration (Khối 5) — equipment standards & governance:
        // device-type hierarchy + ISA-18.2 alarm taxonomy + Standards Board. View-only.
        href: "/equipment-standards",
        label: "nav.equipmentStandards",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.equipmentStandardsDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "standardsIntegration",
        hint: "nav.hint.equipmentStandards",
        engineerOriented: true,
        beta: true,
      },
      {
        // Equipment Integration (Khối 1B) — FOCAS/Euromap integration frameworks
        // (read-only, no live device) + recipe versioning genealogy. View-only.
        href: "/equipment-integration",
        label: "nav.equipmentIntegration",
        icon: <Plug className="h-4 w-4" />,
        description: "nav.equipmentIntegrationDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "standardsIntegration",
        hint: "nav.hint.equipmentIntegration",
        engineerOriented: true,
        beta: true,
      },
      // doc 36 follow-up — /factory-floor-editor, /rf-test-cell and /cell-twin REMOVED:
      // all redirect into the canonical /digital-twin hub (Production group), which is
      // the single Twin entry point. Their views are reachable as tabs inside that hub.
      // (The "twin" section is now empty and is auto-skipped by groupItemsBySection.)
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 5. ANALYTICS — Reports / scheduled / builder · Category / Correlation /
  //    Comparison · Energy / Carbon · realtime report · threshold approvals.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "analytics",
    label: "nav.analyticsGroup",
    icon: <LineChart className="h-4 w-4" />,
    description: "nav.analyticsGroupDesc",
    defaultOpen: false,
    permissionCategory: "analytics",
    sections: [
      { key: "reports", label: "nav.section.reports" },
      { key: "analysis", label: "nav.section.analysis" },
      { key: "energy", label: "nav.section.energy" },
      { key: "targetsSettings", label: "nav.section.targetsSettings" },
    ],
    items: [
      {
        // doc 59 Cụm G — Xưởng báo cáo: studio 4 tab (tạo/lịch/xuất/so sánh) hợp nhất.
        href: "/reporting-studio",
        label: "Xưởng báo cáo",
        icon: <FileBarChart className="h-4 w-4" />,
        description: "Tạo · lịch · xuất PDF/PPTX · so sánh — một studio",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/reports",
        label: "nav.reportsPage",
        icon: <FileBarChart className="h-4 w-4" />,
        description: "nav.reportsPageDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/scheduled-reports",
        label: "nav.scheduledReports",
        icon: <CalendarClock className="h-4 w-4" />,
        description: "nav.scheduledReportsDesc",
        requiredPermission: "reports_schedule",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/report-builder",
        label: "nav.reportBuilder",
        icon: <FileText className="h-4 w-4" />,
        description: "nav.reportBuilderDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/category-analytics",
        label: "nav.categoryAnalytics",
        icon: <PieChart className="h-4 w-4" />,
        description: "nav.categoryAnalyticsDesc",
        requiredPermission: "analytics_category",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        href: "/correlation-analysis",
        label: "nav.correlationAnalysis",
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.correlationAnalysisDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        href: "/data-comparison",
        label: "nav.dataComparison",
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.dataComparisonDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        // doc 46 FE-W3.3 — Comparison Studio: hợp nhất so sánh đa chiều (tuyến/ca/SP/kỳ)
        // + benchmark, 1 công cụ (gộp data-comparison/product-comparison/history-comparison).
        href: "/comparison-studio",
        label: "nav.comparisonStudio",
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.comparisonStudioDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        href: "/realtime-report",
        label: "nav.realtimeReport",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.realtimeReportDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        // W3-A (doc 35 F2): surface orphan /defect-prediction — AI defect-trend
        // forecast. Gated analytics_advanced (matches its route), like correlation/comparison.
        href: "/defect-prediction",
        label: "nav.defectPrediction",
        icon: <TrendingUp className="h-4 w-4" />,
        description: "nav.defectPredictionDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        // W3-A (doc 35 F2): surface orphan /root-cause-analysis — defect RCA workspace.
        // Gated analytics_root_cause (matches its route, same as the causal-graph editor).
        href: "/root-cause-analysis",
        label: "nav.rootCauseAnalysis",
        icon: <Search className="h-4 w-4" />,
        description: "nav.rootCauseAnalysisDesc",
        requiredPermission: "analytics_root_cause",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        href: "/energy-analytics",
        label: "nav.energyAnalytics",
        icon: <Zap className="h-4 w-4" />,
        description: "nav.energyAnalyticsDesc",
        requiredPermission: "energy",
        permissionCategory: "analytics",
        section: "energy",
      },
      {
        href: "/carbon-dashboard",
        label: "nav.carbonDashboard",
        icon: <Leaf className="h-4 w-4" />,
        description: "nav.carbonDashboardDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "energy",
      },
      {
        href: "/pdf-reports",
        label: "nav.pdfReports",
        icon: <FileText className="h-4 w-4" />,
        description: "nav.pdfReportsDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/powerpoint-export",
        label: "nav.powerpointExport",
        icon: <Presentation className="h-4 w-4" />,
        description: "nav.powerpointExportDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/threshold-approvals",
        label: "nav.thresholdApprovals",
        icon: <ClipboardCheck className="h-4 w-4" />,
        description: "nav.thresholdApprovalsDesc",
        requiredPermission: "settings_alerts",
        permissionCategory: "analytics",
        section: "targetsSettings",
      },
      {
        // doc 35 W4-B — NCR/MRB; plain label (i18n polish deferred)
        href: "/nonconformance",
        label: "Báo cáo không phù hợp (NCR/MRB)",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "Nonconformance/MRB: mở → review → disposition (use-as-is/rework/scrap/return/RTV) → đóng, SoD",
        requiredPermission: "analytics_spc",
        permissionCategory: "analytics",
        section: "targetsSettings",
      },
      {
        href: "/oee-target-settings",
        label: "nav.oeeTargets",
        icon: <Target className="h-4 w-4" />,
        description: "nav.oeeTargetsDesc",
        requiredPermission: "analytics_oee_targets",
        permissionCategory: "analytics",
        section: "targetsSettings",
      },
      // doc 36 follow-up — /analytics-setting REMOVED: mọi tab của nó đều đã là route độc
      // lập (reports/report-builder/pdf/powerpoint/correlation/data-comparison/... + các tab
      // SPC/gate/annotation redirect vào /quality-cockpit) đã có mặt ở menu Phân tích/Chất
      // lượng. Route /analytics-setting nay redirect → /reports (App.tsx).
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 6. AI — doc 69 Wave E1 (T6): SINGLE AI taxonomy. The rail is now the only
  //    index of the ~20 AI pages — previously they were indexed a 3rd time by
  //    two separate hub walls (AIHub's read-open 20-tile grid + AIStudioHub's
  //    admin-only 20-tool launcher, both at /ai-hub and /ai-studio). Both are
  //    RETIRED and MERGED into one "AI Home" landing (/ai-home, App.tsx
  //    redirects the old URLs) that presents this SAME taxonomy as tiles.
  //    "Assistant" (Chat/Inbox/Management Insight) + AI Home itself are
  //    tier:'simple' — rescued from the group's tier:'advanced' so they stay
  //    visible in Simple mode (doc 22 P4). The deeper Agent Operations /
  //    Analytics & Reports / Vision Lab / Models / Settings sections keep
  //    their original per-item requiredRole/requiredPermission gates
  //    UNCHANGED and stay hidden in Simple mode (untagged → advanced default).
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "ai",
    label: "nav.aiGroup",
    icon: <Sparkles className="h-4 w-4" />,
    description: "nav.aiGroupDesc",
    defaultOpen: false,
    tier: "advanced",
    // No permissionCategory → group is visible to every authenticated role; the
    // Assistant items below are read-open. Admin-only items below still gate.
    sections: [
      { key: "assistant", label: "nav.section.aiAssistant" },
      { key: "agentOps", label: "nav.section.aiAgentOps" },
      { key: "analyticsReports", label: "nav.section.aiAnalyticsReports" },
      { key: "visionLab", label: "nav.section.aiVisionLab" },
      // doc 69 Wave E1 (T7) — NEW section T6 deferred: durable training assets
      // (dataset splits; Knowledge Base RAG docs is a later E3 task, NOT built here —
      // see doc 69 §B1.2/§B3). Training Studio (E3-2) added below.
      { key: "knowledgeTraining", label: "nav.section.aiKnowledgeTraining" },
      { key: "models", label: "nav.section.aiModels" },
      { key: "settings", label: "nav.section.aiSettings" },
    ],
    items: [
      // ─ AI Home — merged landing (doc 69 B1.2), leading row (no section,
      //   same pattern as /control-tower in the Overview group). Read-open +
      //   tier:'simple' so every role has a single front door into AI. ─
      {
        href: "/ai-home",
        label: "nav.aiHome",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.aiHomeDesc",
        tier: "simple",
      },
      // ─ Assistant (read-open, all roles; rescued to Simple mode) ─
      {
        href: "/ai-chat",
        label: "nav.aiChat",
        icon: <MessageSquare className="h-4 w-4" />,
        description: "nav.aiChatDesc",
        section: "assistant",
        tier: "simple",
      },
      {
        // doc 69 T6 — fix orphan: promoted into the AI taxonomy's Assistant
        // section. Was already reachable via the header AIActionInboxLauncher
        // and the "Me" group's personal shortcut row (nav.inbox); both of
        // those stay unchanged — this ADDS the AI-context entry point.
        href: "/inbox",
        label: "nav.inbox",
        icon: <Inbox className="h-4 w-4" />,
        description: "nav.inboxDesc",
        section: "assistant",
        tier: "simple",
      },
      // doc 41 (2026-07-11) — /programming-copilot entry TRÙNG ở đây ĐÃ GỠ. Copilot lập
      // trình là một EXTENSION nhúng trong các editor (Engineering Workspace / IR / POU),
      // không phải một đích đến riêng; nhà duy nhất còn lại là trang scratchpad ở
      // "Kỹ thuật ▸ Soạn thảo & Lập trình" (sinh code nhanh khi chưa mở project).
      {
        href: "/management-insight",
        label: "nav.managementInsight",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.managementInsightDesc",
        section: "assistant",
        tier: "simple",
      },
      // ─ Agent Operations (admin) ─
      {
        href: "/ai-brain",
        label: "nav.aiBrainDashboard",
        icon: <Brain className="h-4 w-4" />,
        description: "nav.aiBrainDashboardDesc",
        // doc69 Wave 0-C — engineer (kỹ thuật) does agent-ops daily work; backend
        // (opsAgentCenterProcedure / equivalent role gates) already allows engineer.
        //
        // ★★★ Pha 5 Task 3 (N9) — 'supervisor' THÊM VÀO, và đây là LỚP 1 của năm lớp.
        // Màn này là nhà DUY NHẤT của `VramBrokerPanel` (mặt lệnh VRAM). Chủ dự án chốt
        // `supervisor` được ra lệnh phá huỷ VRAM (`ACTUATION_ROLES` đã có nó —
        // `server/_core/trpc.ts:495`). Bật nút cho một vai KHÔNG VÀO ĐƯỢC MÀN là dựng một
        // cái nút không ai bấm được, và khai đã trao quyền trong khi chưa.
        // ⚠ `/ai-command-center` và các màn agent-ops khác KHÔNG mở: `supervisor` không có
        // sàn `aiAgent.listAgentSessionsForOps` (admin|engineer) — mở nav ở đó sẽ là đúng
        // cùng lỗi, chỉ đổi bề mặt. Trên /ai-brain phần Agent Ops tự khai "cần quyền admin
        // hoặc kỹ thuật" qua `isOpsRole`, KHÔNG bịa dữ liệu.
        requiredRole: ['admin', 'engineer', 'supervisor'],
        // ⚠ m-2 — Ô CHẾT, giữ vì nợ có trước: `isItemAccessible` (:2334) chỉ đọc
        // `requiredPermission`; `permissionCategory` chỉ có tác dụng ở CẤP GROUP
        // (`applyRbacFilter`). Đừng đọc dòng này thành "còn một cổng quyền nữa".
        permissionCategory: "admin",
        section: "agentOps",
        // ★★★ Pha 5 Task 3 review (I-1) — LỚP THỨ SÁU, và nó đóng ĐÚNG với `supervisor`.
        // `defaultNavModeForRole('supervisor') === 'simple'` (:2119 `ADVANCED_DEFAULT_ROLES`
        // không có supervisor) và group `ai` khai `tier:"advanced"` ⇒ `filterNavGroupsByMode`
        // ở chế độ `simple` giữ **CHỈ** item khai TƯỜNG MINH `tier:'simple'`. Không có dòng
        // này thì supervisor mở thanh bên và **không thấy dòng nào** — đúng câu "anh bảo cấp
        // quyền rồi mà tôi không thấy màn đâu". Vô hình tới giờ vì `engineer` mặc định
        // `advanced`; nó chỉ lộ khi thêm một vai KHÔNG kỹ thuật, tức đúng lúc này.
        tier: "simple",
      },
      {
        // doc69 GĐ4/E2-3 — Agent Command Center (roster + savings + task feed + drill-in).
        // Wave 0-C: backend opsAgentCenterProcedure = roleProcedure("admin","engineer").
        href: "/ai-command-center",
        label: "nav.aiCommandCenter",
        icon: <Bot className="h-4 w-4" />,
        description: "nav.aiCommandCenterDesc",
        requiredRole: ['admin', 'engineer'],
        permissionCategory: "admin",
        section: "agentOps",
      },
      {
        // Wave 1 — cửa vào GIAO VIỆC cho 4 specialist agent. Cùng bộ quyền với
        // /ai-command-center vì đây là việc phát triển phần mềm, không phải vận hành.
        href: "/ai-specialist-studio",
        label: "nav.aiSpecialistStudio",
        icon: <Wrench className="h-4 w-4" />,
        description: "nav.aiSpecialistStudioDesc",
        requiredRole: ['admin', 'engineer'],
        permissionCategory: "admin",
        section: "agentOps",
      },
      {
        // Wave 0-C: left admin-only — system health/config, not engineer daily work.
        href: "/ai-monitoring",
        label: "nav.aiMonitoring",
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.aiMonitoringDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "agentOps",
      },
      {
        // doc69 Wave 0-C — engineer curates active-learning queues as daily work.
        href: "/ai-active-learning",
        label: "nav.aiActiveLearning",
        icon: <GraduationCap className="h-4 w-4" />,
        description: "nav.aiActiveLearningDesc",
        requiredRole: ['admin', 'engineer'],
        permissionCategory: "admin",
        section: "agentOps",
      },
      {
        href: "/ai-batch-jobs",
        label: "nav.aiBatchJobs",
        icon: <Layers className="h-4 w-4" />,
        description: "nav.aiBatchJobsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "agentOps",
      },
      {
        href: "/ai-data-processing",
        label: "nav.aiDataProcessing",
        icon: <Database className="h-4 w-4" />,
        description: "nav.aiDataProcessingDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "agentOps",
      },
      // ─ Analytics & Reports ─
      {
        // doc 69 T6 — fix orphan: page existed (App.tsx guards it explicitly
        // with requirePermission="analytics_ai_performance") but had NO nav
        // row anywhere before this.
        href: "/ai-inspection-analytics",
        label: "nav.aiInspectionAnalytics",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.aiInspectionAnalyticsDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
        section: "analyticsReports",
      },
      {
        href: "/ai-performance",
        label: "nav.aiPerformance",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.aiPerformanceDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "analyticsReports",
      },
      {
        // doc 69 Wave E1 (T7) — split out of AIPerformanceDashboard's evaluation
        // (before/after) + A/B canary tabs. Same RBAC gate as /ai-performance.
        href: "/ai-experiments",
        label: "nav.aiExperiments",
        icon: <FlaskConical className="h-4 w-4" />,
        description: "nav.aiExperimentsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "analyticsReports",
      },
      {
        href: "/ai-time-series",
        label: "nav.aiTimeSeries",
        icon: <TrendingUp className="h-4 w-4" />,
        description: "nav.aiTimeSeriesDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "analyticsReports",
      },
      {
        href: "/ai-reports",
        label: "nav.aiReports",
        icon: <FileBarChart className="h-4 w-4" />,
        description: "nav.aiReportsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "analyticsReports",
      },
      // ─ Vision Lab ─
      {
        href: "/ai-quality-gate",
        label: "nav.aiQualityGate",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.aiQualityGateDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "visionLab",
      },
      {
        href: "/ai-image-search",
        label: "nav.aiImageSearch",
        icon: <Search className="h-4 w-4" />,
        description: "nav.aiImageSearchDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "visionLab",
      },
      {
        href: "/ai-advanced-vision-lab",
        label: "nav.advancedVisionLab",
        icon: <Camera className="h-4 w-4" />,
        description: "nav.advancedVisionLabDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "visionLab",
      },
      {
        // doc69 Wave 0-C — engineers curate anomaly banks as daily vision-lab work.
        href: "/anomaly-banks",
        label: "nav.anomalyBanks",
        icon: <Database className="h-4 w-4" />,
        description: "nav.anomalyBanksDesc",
        requiredRole: ['admin', 'engineer'],
        permissionCategory: "admin",
        section: "visionLab",
      },
      {
        // doc69 Wave 0-C — engineers annotate defect masks as daily vision-lab work.
        href: "/mask-annotation",
        label: "nav.maskAnnotation",
        icon: <Brush className="h-4 w-4" />,
        description: "nav.maskAnnotationDesc",
        requiredRole: ['admin', 'engineer'],
        permissionCategory: "admin",
        section: "visionLab",
      },
      {
        href: "/causal-graph",
        label: "nav.causalGraph",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.causalGraphDesc",
        requiredPermission: "analytics_root_cause",
        permissionCategory: "analytics",
        section: "visionLab",
      },
      // ─ Knowledge & Training (doc 69 Wave E1 / T7 — NEW section) ─
      {
        // Split out of AIDataProcessingPage's dataset tab: a dataset split is a
        // durable training asset, not an ephemeral pipeline step. Same RBAC
        // gate as /ai-data-processing. Knowledge Base (RAG docs, /ai-knowledge)
        // is a later E3 task — NOT added here.
        // doc69 Wave 0-C fix round 1 — kept admin-only, NOT widened: the aiEval/MLOps
        // surface (buildDataset, model eval, pipelines) is intentionally admin-governed
        // (backend `aiEval.buildDataset` is `adminProcedure` by design, not an
        // oversight). The engineer's training screen is /ai-training-studio (KB
        // corpus/ingest, admin+engineer by design) — widening this one too would leave
        // engineers on a page whose only action always 403s.
        href: "/ai-datasets",
        label: "nav.aiDatasets",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.aiDatasetsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "knowledgeTraining",
      },
      {
        // doc69 GĐ5/Wave E3 (E3-2) — Training Studio: corpus registry + job-tracked
        // doc/URL ingest (Source/Jobs/Corpus/Eval/Model Builder tabs). doc69 Wave 0-C:
        // nav gate widened to match the backend kbStudioRouter.ts, which is already
        // admin+engineer (+2FA); deleteCorpus stays narrower, admin-only, unaffected
        // by this nav-level widening.
        href: "/ai-training-studio",
        label: "nav.aiTrainingStudio",
        icon: <GraduationCap className="h-4 w-4" />,
        description: "nav.aiTrainingStudioDesc",
        requiredRole: ['admin', 'engineer'],
        permissionCategory: "admin",
        section: "knowledgeTraining",
      },
      // ─ Models ─
      {
        href: "/ai-models",
        label: "nav.aiModelManagement",
        icon: <Cpu className="h-4 w-4" />,
        description: "nav.aiModelManagementDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "models",
      },
      {
        href: "/model-versions",
        label: "nav.modelVersions",
        icon: <GitBranch className="h-4 w-4" />,
        description: "nav.modelVersionsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "models",
      },
      {
        // doc 69 T6 — fix orphan: page existed (App.tsx guards it explicitly
        // with requireRole={["admin"]}) but had NO nav row anywhere before this.
        href: "/ai-gguf-models",
        label: "nav.aiGgufModels",
        icon: <FileStack className="h-4 w-4" />,
        description: "nav.aiGgufModelsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "models",
      },
      {
        // Automation Orchestration (Khối 4, I2) — advisory robot-behaviour anomaly
        // monitoring + AI model rollback audit. AI-observability, read-mostly cockpit;
        // reads gated on machine_monitoring (like robot-control / fleet-orchestration),
        // mutations gated on machine_control/canEdit inside the page + I2 flags.
        href: "/robot-model-health",
        label: "nav.robotModelHealth",
        icon: <Bot className="h-4 w-4" />,
        description: "nav.robotModelHealthDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "models",
      },
      // ─ Settings ─
      {
        href: "/ai-settings",
        label: "nav.aiSettings",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.aiSettingsDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "settings",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 7. ADMIN — Admin & Security (hub / users / roles / audit / license / backup
  //    / api keys / sessions / system settings). Landing for admin.
  //    2026-07-11 — Master Data tách ra group `data-management` riêng (xem 7b):
  //    quản trị = chức năng cho admin; dữ liệu chủ = cho người dùng quản lý.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "admin",
    label: "nav.adminGroup",
    icon: <Shield className="h-4 w-4" />,
    description: "nav.adminGroupDesc",
    defaultOpen: false,
    requiredRole: 'admin',
    permissionCategory: "admin",
    // doc 22 P4 — platform/governance internals (incl. Federation): Advanced-only.
    tier: "advanced",
    sections: [
      { key: "securityAccess", label: "nav.section.securityAccess" },
      { key: "platform", label: "nav.section.platform" },
    ],
    items: [
      {
        // doc 59 cụm phụ — Settings Hub: một cửa cho mọi trang cài đặt (hệ thống/bảo mật/
        // thiết bị/AI/mục tiêu). Per-tile RBAC (tile admin ẩn cho non-admin).
        href: "/settings-hub",
        label: "Trung tâm cài đặt",
        icon: <SlidersHorizontal className="h-4 w-4" />,
        description: "Cài đặt hệ thống · bảo mật · thiết bị · AI · mục tiêu — một nơi",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "platform",
      },
      {
        // doc 67 W5 (việc 1) — DỜI từ group Tổng quan về Admin: quản lý/tùy biến
        // dashboard (Custom / Templates / Marketplace) là tác vụ quản trị, không
        // phải cửa vào hằng ngày. Giữ nguyên gate admin như cũ.
        href: "/dashboard-center",
        label: "nav.dashboardCenter",
        icon: <LayoutDashboard className="h-4 w-4" />,
        description: "nav.dashboardCenterDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
      },
      {
        href: "/admin-home",
        label: "nav.adminHome",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.adminHomeDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/users",
        label: "nav.usersPage",
        icon: <Users className="h-4 w-4" />,
        description: "nav.usersPageDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_users",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/role-builder",
        label: "nav.roleBuilder",
        icon: <UserCog className="h-4 w-4" />,
        description: "nav.roleBuilderDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_users",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/audit-logs?tab=enhanced",
        label: "nav.enhancedAudit",
        icon: <ScrollText className="h-4 w-4" />,
        description: "nav.enhancedAuditDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/license",
        label: "nav.licenseManagement",
        icon: <KeyRound className="h-4 w-4" />,
        description: "nav.licenseManagementDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/api-keys",
        label: "nav.apiKeys",
        icon: <KeyRound className="h-4 w-4" />,
        description: "nav.apiKeysDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/sites",
        label: "nav.sites",
        icon: <Network className="h-4 w-4" />,
        description: "nav.sitesDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
      },
      {
        href: "/federation-dashboard",
        label: "nav.federationDashboard",
        icon: <Globe className="h-4 w-4" />,
        description: "nav.federationDashboardDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
        hint: "nav.hint.federationDashboard",
        engineerOriented: true,
        beta: true,
      },
      {
        href: "/modules",
        label: "nav.modules",
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "nav.modulesDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
      },
      {
        // doc 33 — SYNAPSE platform cockpit (read-only: editions/plugins/security/observability/contracts/dev-portal)
        href: "/synapse-platform",
        label: "nav.synapsePlatform",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.synapsePlatformDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
        beta: true,
      },
      {
        href: "/backup-restore",
        label: "nav.backupRestore",
        icon: <Archive className="h-4 w-4" />,
        description: "nav.backupRestoreDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
      },
      {
        href: "/sessions",
        label: "nav.sessions",
        icon: <Monitor className="h-4 w-4" />,
        description: "nav.sessionsDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/corporate-management",
        label: "nav.corporateManagement",
        icon: <Settings className="h-4 w-4" />,
        description: "nav.corporateManagementDesc",
        requiredRole: 'admin',
        requiredPermission: "dashboard_corporate",
        permissionCategory: "dashboard",
        section: "platform",
      },
      {
        href: "/settings",
        label: "nav.generalSettings",
        icon: <Settings className="h-4 w-4" />,
        description: "nav.generalSettingsDesc",
        requiredPermission: "settings_view",
        permissionCategory: "settings",
        section: "platform",
      },
      // doc 39 — Settings ?tab= deep-link rows removed (redundant with in-page tabs);
      // the plain /settings entry above is the single menu row.
      {
        href: "/admin-setting",
        label: "nav.adminSetting",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.adminSettingDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
      },
      // doc 39 — Admin Setting ?tab= deep-link rows removed (redundant with in-page tabs);
      // the plain /admin-setting entry above is the single menu row.
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 7b. DATA MANAGEMENT — master data người dùng quản lý (sản phẩm, thư viện
  //     linh kiện, badge, layout, trạm, quy trình, cài đặt dữ liệu). Tách khỏi
  //     group ADMIN 2026-07-11: KHÔNG requiredRole:'admin' và KHÔNG tier
  //     advanced — người dùng thường (có quyền settings/masterdata) thấy được;
  //     RBAC vẫn gate từng item. Backing SKU: MOD_DATA_MANAGEMENT → app "data".
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "data-management",
    label: "nav.dataGroup",
    icon: <Database className="h-4 w-4" />,
    description: "nav.dataGroupDesc",
    defaultOpen: false,
    permissionCategory: "settings",
    sections: [
      // Doc 31 UX7 — coherent "Product & Program" cluster (products/mapping/
      // component-library) split out of the generic Master Data section.
      { key: "productProgram", label: "nav.section.productProgram" },
      { key: "masterData", label: "nav.section.masterData" },
      { key: "factoryConfig", label: "nav.section.factoryConfig" },
    ],
    items: [
      {
        // doc 59 Cụm D — "nhà Data" thống nhất: rail 3 nhóm (Sản phẩm&Chương trình /
        // Dữ liệu chủ / Cấu hình nhà máy&Quản trị) ⇄ launcher managers. Một cửa vào duy
        // nhất thay vì rải; các mục con vẫn giữ để deep-link.
        href: "/data-management",
        label: "Trung tâm dữ liệu",
        icon: <Database className="h-4 w-4" />,
        description: "Một nơi cho mọi dữ liệu: sản phẩm · dữ liệu chủ · cấu hình nhà máy",
        requiredPermission: "masterdata",
        permissionCategory: "settings",
        section: "productProgram",
      },
      {
        // doc 59 Cụm E — Xưởng sản phẩm: hub-launcher hợp nhất định-nghĩa/chuẩn-vàng theo
        // sản phẩm. Gate BẬC THẤP NHẤT (history_view) + per-tile RBAC trong hub.
        href: "/product-workspace",
        label: "Xưởng sản phẩm",
        icon: <Package className="h-4 w-4" />,
        description: "Định nghĩa sản phẩm · biến thể · chuẩn vàng · chất lượng — một nơi",
        requiredPermission: "history_view",
        permissionCategory: "history",
        section: "productProgram",
      },
      {
        href: "/master-data",
        label: "nav.masterData",
        icon: <Tags className="h-4 w-4" />,
        description: "nav.masterDataDesc",
        requiredPermission: "masterdata",
        permissionCategory: "settings",
        section: "masterData",
      },
      // doc 39 — Master Data ?tab= deep-link rows removed (redundant with in-page tabs);
      // the plain /master-data entry above is the single menu row.
      // W8-A (doc 27 M12a / doc 29 §1): component package/footprint library.
      {
        href: "/component-library",
        label: "nav.componentLibrary",
        icon: <Cpu className="h-4 w-4" />,
        description: "nav.componentLibraryDesc",
        requiredPermission: "masterdata",
        permissionCategory: "settings",
        section: "productProgram", // Doc 31 UX7
      },
      // W8-B (doc 29 §3 — M14): operator/badge master (badgeCode → users.id).
      {
        href: "/operator-badges",
        label: "nav.operatorBadges",
        icon: <Users className="h-4 w-4" />,
        description: "nav.operatorBadgesDesc",
        requiredPermission: "masterdata",
        permissionCategory: "settings",
        section: "masterData",
      },
      // doc 42 Đợt 4B (H4): master-data audit trail (read-only "ai đổi gì, khi nào").
      // Locale keys nav.masterDataAudit(Desc) đã đồng bộ vi/en/zh (nợ nhỏ doc 42).
      {
        href: "/master-data-audit",
        label: "nav.masterDataAudit",
        icon: <History className="h-4 w-4" />,
        description: "nav.masterDataAuditDesc",
        requiredPermission: "masterdata",
        permissionCategory: "settings",
        section: "masterData",
      },
      // doc 42 Đợt 5 (K1): bảng điều khiển chất lượng dữ liệu chủ (thiếu trường /
      // tham chiếu mồ côi, chỉ đọc). Locale keys nav.dataQuality(Desc) đã đồng bộ
      // vi/en/zh (doc 42 Đợt 3 i18n pass — giống nav.masterDataAudit).
      {
        href: "/data-quality",
        label: "nav.dataQuality",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.dataQualityDesc",
        requiredPermission: "masterdata",
        permissionCategory: "settings",
        section: "masterData",
      },
      {
        // doc 46 FE-W2 — Metric Catalog: lộ semantic layer (định nghĩa KPI có phiên bản
        // OEE@v1 + công thức + lineage, chỉ đọc; trpc.semantics). Gate machine_status để
        // quản lý/kỹ sư đọc được định nghĩa KPI. Nhãn trực tiếp (i18n key hoãn — theo tiền lệ War-room).
        href: "/metric-catalog",
        label: "Danh mục chỉ số (Metric Catalog)",
        icon: <BookOpen className="h-4 w-4" />,
        description: "Semantic layer: định nghĩa KPI có phiên bản (OEE@v1) · công thức · nguồn dữ liệu (lineage)",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "masterData",
      },
      {
        href: "/products",
        label: "nav.productsPage",
        icon: <Package className="h-4 w-4" />,
        description: "nav.productsPageDesc",
        requiredPermission: "settings_products",
        permissionCategory: "settings",
        section: "productProgram", // Doc 31 UX7
      },
      {
        // WD-1 (doc 31 Đợt D · UX1) — guided product setup: ties the 9-10
        // scattered product-config destinations into one resumable wizard.
        href: "/product-onboarding",
        label: "nav.productOnboarding",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.productOnboardingDesc",
        requiredPermission: "settings_products",
        permissionCategory: "settings",
        section: "productProgram", // Doc 31 UX7
      },
      {
        href: "/product-mapping",
        label: "nav.productMapping",
        icon: <Link className="h-4 w-4" />,
        description: "nav.productMappingDesc",
        requiredPermission: "settings_product_mapping",
        permissionCategory: "settings",
        section: "productProgram", // Doc 31 UX7
      },
      {
        // doc 47 IA Đợt 1 — hub landing for factory-model config; it LINKS OUT to the
        // single-home pages below instead of re-embedding their managers. First in section.
        href: "/datasettings",
        label: "nav.dataSettingsPage",
        icon: <Database className="h-4 w-4" />,
        description: "nav.dataSettingsPageDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
        section: "factoryConfig",
      },
      {
        href: "/layout",
        label: "nav.factoryLayout",
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "nav.factoryLayoutDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
        section: "factoryConfig",
      },
      {
        href: "/workstation-management",
        label: "nav.workstationManagement",
        icon: <Warehouse className="h-4 w-4" />,
        description: "nav.workstationManagementDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
        section: "factoryConfig",
      },
      {
        href: "/process-management",
        label: "nav.processManagement",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.processManagementDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
        section: "factoryConfig",
      },
      // doc 39/47 — DataSettings ?tab= deep-link rows removed (redundant with in-page tabs);
      // the /datasettings hub entry (first in this section) is the single menu row.
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 8. ME (self) — personal surfaces, READ-OPEN to every authenticated role
  //    (no permission gate). Profile · Operator inbox/today shell · Request role
  //    · User guide · About.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "me",
    label: "nav.meGroup",
    icon: <User className="h-4 w-4" />,
    description: "nav.meGroupDesc",
    defaultOpen: false,
    items: [
      {
        // P3-W2: full-screen Action Inbox (read-open all roles).
        href: "/inbox",
        label: "nav.inbox",
        icon: <Inbox className="h-4 w-4" />,
        description: "nav.inboxDesc",
      },
      {
        // P3-W2: full-screen Today Briefing (read-open all roles).
        href: "/today",
        label: "nav.today",
        icon: <Sun className="h-4 w-4" />,
        description: "nav.todayDesc",
      },
      {
        href: "/operator",
        label: "nav.operatorHome",
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "nav.operatorHomeDesc",
      },
      {
        href: "/profile",
        label: "nav.profile",
        icon: <User className="h-4 w-4" />,
        description: "nav.profileDesc",
      },
      {
        href: "/change-password",
        label: "nav.changePassword",
        icon: <Lock className="h-4 w-4" />,
        description: "nav.changePasswordDesc",
      },
      {
        href: "/request-role",
        label: "nav.requestRole",
        icon: <ShieldQuestion className="h-4 w-4" />,
        description: "nav.requestRoleDesc",
      },
      {
        href: "/user-guide",
        label: "nav.userGuide",
        icon: <BookOpen className="h-4 w-4" />,
        description: "nav.userGuideDesc",
      },
      {
        href: "/about-system",
        label: "nav.aboutSystem",
        icon: <Building2 className="h-4 w-4" />,
        description: "nav.aboutSystemDesc",
      },
    ],
  },
];

// Flat navigation items for backward compatibility
export const navItems: NavItem[] = navGroups.flatMap(group => group.items);

// ──────────────────────────────────────────────────────────────────────────────
// Simple vs Advanced menu mode (doc 22 P4).
// ──────────────────────────────────────────────────────────────────────────────

export type NavMode = 'simple' | 'advanced';

/** Roles that DEFAULT to Advanced mode (see everything up-front). Everyone else
 *  (operator/supervisor/viewer/user/quality_inspector/…) defaults to Simple. */
const ADVANCED_DEFAULT_ROLES = new Set(['admin', 'it_admin', 'engineer']);

/** The default menu mode for a role — technical roles start Advanced, the rest Simple. */
export function defaultNavModeForRole(role?: string | null): NavMode {
  return role && ADVANCED_DEFAULT_ROLES.has(role) ? 'advanced' : 'simple';
}

/** An item/group is "advanced" only when explicitly tagged; untagged → simple. */
function isAdvancedGroup(group: NavGroup): boolean {
  return group.tier === 'advanced';
}
function isAdvancedItem(item: NavItem): boolean {
  return item.tier === 'advanced';
}

/**
 * Does the given (already role/permission-filtered) group list contain anything
 * that Simple mode would hide? Used to decide whether to SHOW the Advanced toggle
 * at all (no point offering it to a role that has no advanced surface).
 */
export function hasAdvancedContent(groups: NavGroup[]): boolean {
  return groups.some(g => isAdvancedGroup(g) || g.items.some(isAdvancedItem));
}

/**
 * Filter nav groups by menu mode. In `advanced` mode nothing is removed.
 *
 * In `simple` mode:
 *   - A SIMPLE group keeps every item that is not explicitly advanced (untagged =
 *     simple, backward-compatible).
 *   - An ADVANCED group is NO LONGER dropped wholesale (doc 40 Lan): it survives but
 *     is trimmed to ONLY the items EXPLICITLY tagged `tier: 'simple'`. This surfaces
 *     the operator/maintenance core tools (device-monitor, alerts, feeder-verify,
 *     work-orders, technician-copilot) that live inside the advanced "Devices" group,
 *     while the engineering-heavy rows (untagged/advanced) stay hidden. A group with
 *     no explicit-simple item drops out exactly as before.
 *
 * Purely additive — runs AFTER getFilteredNavGroups, so advanced-mode flows are
 * untouched.
 */
export function filterNavGroupsByMode(groups: NavGroup[], mode: NavMode): NavGroup[] {
  if (mode === 'advanced') return groups;
  return groups
    .map(group =>
      isAdvancedGroup(group)
        ? { ...group, items: group.items.filter(item => item.tier === 'simple') }
        : { ...group, items: group.items.filter(item => !isAdvancedItem(item)) },
    )
    .filter(group => group.items.length > 0);
}

// Helper to get group by item href
export function getGroupByHref(href: string): NavGroup | undefined {
  return navGroups.find(group => group.items.some(item => item.href === href));
}

/**
 * F2 (doc 23 §5 E3) — route-prefix active matcher.
 *
 * Highlights a nav item as active when the CURRENT location matches the item's
 * href by PATH PREFIX (query strings stripped on both sides), so child/query
 * routes light up their parent:
 *   - `/audit-logs?tab=enhanced` → matches item `/audit-logs?tab=enhanced` AND
 *     the bare `/audit-logs` family (query ignored).
 *   - `/machine/42`              → matches item `/machine`.
 *
 * Guarded against false positives: a prefix match must break on a path boundary
 * (the next char in the location is `/`), so `/reports` does NOT match
 * `/report-builder`. The root href `/` only matches the exact root path.
 */
export function isNavItemActive(itemHref: string, currentPath: string): boolean {
  const [item, itemQuery = ""] = (itemHref || "").split("?");
  const [current, currentQuery = ""] = (currentPath || "").split("?");
  // Path must match first (exact, or a child path — never a bare prefix like /report vs
  // /report-builder). Root ("/") must be exact.
  const pathMatches =
    item === current || (item !== "/" && current.startsWith(item + "/"));
  if (!pathMatches) return false;
  // doc 36 W2/follow-up — a nav item that PINS a `?tab=` (the "bóc hub" deep-links, e.g.
  // /quality-cockpit?tab=spc) is active ONLY when the current tab matches, so sibling
  // tab entries don't all light up together. Items without a tab keep path-only matching.
  const itemTab = new URLSearchParams(itemQuery).get("tab");
  if (itemTab != null) {
    return new URLSearchParams(currentQuery).get("tab") === itemTab;
  }
  return true;
}

/** Look up a nav item by its href (ignoring any query string). */
export function getNavItemByHref(href: string): NavItem | undefined {
  const path = href.split("?")[0];
  return navItems.find(item => item.href.split("?")[0] === path);
}

/** doc 22 P4 — is the given route a not-yet-live (beta) surface? Drives the page banner. */
export function isBetaRoute(href: string): boolean {
  return getNavItemByHref(href)?.beta === true;
}

/**
 * Group an (already role/permission/license-filtered) group's items by their `section`.
 * Returns ordered buckets following group.sections; items without a section (or groups
 * without a sections array) fall into a { key: null } bucket rendered flat.
 * Empty buckets (all items filtered out) are dropped.
 *
 * U15 (doc 26 §3.1) — sectionless items that appear BEFORE the first sectioned item
 * (e.g. the Engineering Hub landing) surface in a LEADING flat bucket so they read as
 * a group front-door at the top; sectionless items after that stay in the trailing
 * catch-all. When no item is sectioned, everything falls to the single trailing bucket
 * (unchanged behaviour).
 */
export function groupItemsBySection(
  group: NavGroup,
): { key: string | null; label: string | null; items: NavItem[] }[] {
  // No section definition → render flat.
  if (!group.sections) {
    return [{ key: null, label: null, items: group.items }];
  }

  const buckets: { key: string | null; label: string | null; items: NavItem[] }[] = [];
  const sectionKeys = new Set(group.sections.map(s => s.key));
  const hasSection = (item: NavItem): boolean =>
    item.section !== undefined && sectionKeys.has(item.section);

  // Leading landing bucket — sectionless items before the first sectioned item.
  const firstSectioned = group.items.findIndex(hasSection);
  const leading =
    firstSectioned === -1 ? [] : group.items.slice(0, firstSectioned).filter(i => !hasSection(i));
  if (leading.length > 0) {
    buckets.push({ key: null, label: null, items: leading });
  }

  // Ordered, labelled section buckets — skip any that ended up empty after filtering.
  for (const { key, label } of group.sections) {
    const items = group.items.filter(item => item.section === key);
    if (items.length > 0) {
      buckets.push({ key, label, items });
    }
  }

  // Trailing catch-all for the remaining sectionless items (or sections not declared
  // in group.sections) so nothing is ever dropped; rendered flat (no sub-header).
  const leadingSet = new Set(leading);
  const orphanItems = group.items.filter(item => !hasSection(item) && !leadingSet.has(item));
  if (orphanItems.length > 0) {
    buckets.push({ key: null, label: null, items: orphanItems });
  }

  return buckets;
}

/**
 * Hub routes — "settings/management hub" pages that carry their OWN in-page navigation
 * MENU (a vertical sub-menu of sections, e.g. /monitoring-setting). These are promoted
 * to Level 2 as directly-clickable entries (click → straight to the page; the page's own
 * in-page menu is the sub-nav, so no Level-3 flyout). Non-hub pages stay grouped under
 * their section category with a Level-3 menu. (Flat modules — Overview / Quality / Me —
 * already render items at Level 2, so a flag here is a no-op for them.)
 *
 * To extend: add the href of any page that has a real in-page navigation menu.
 */
export const HUB_ROUTES = new Set<string>([
  "/monitoring-setting", // Devices — vertical sub-menu (registration / devices / MQTT clients / topics / replay / profiles / NG-rate)
  // doc 36 follow-up — "/analytics-setting" REMOVED: that route now redirects → /reports
  // (App.tsx) and has no menu item, so it is not a hub target anymore.
  "/settings",           // Admin — general settings sub-menu
  "/admin-setting",      // Admin — admin settings sub-menu
  "/datasettings",       // Admin — data settings sub-menu
  "/dashboard-center",   // Overview (flat — already L2) — dashboard hub sub-menu
]);

export function isHubItem(item: NavItem): boolean {
  return HUB_ROUTES.has(item.href);
}

/** A Level-2 entry: either a directly-clickable hub link, or a category that opens
 *  a Level-3 menu of its (non-hub) pages. */
export type L2Entry =
  | { kind: "link"; item: NavItem }
  | { kind: "category"; key: string; label: string; items: NavItem[] };

/**
 * Build the Level-2 list for a module (already role/permission/license-filtered):
 * hub pages → direct `link` entries; the remaining non-hub pages stay grouped into
 * `category` entries (Level-3 on hover/tap). Within each section the category is
 * emitted first, then that section's hub links, so hubs stay near their group.
 * Flat / orphan items render as direct links (they are already Level 2).
 */
export function buildModuleL2(group: NavGroup): L2Entry[] {
  const out: L2Entry[] = [];
  for (const bucket of groupItemsBySection(group)) {
    if (bucket.key === null || bucket.label === null) {
      for (const item of bucket.items) out.push({ kind: "link", item });
      continue;
    }
    const nonHub = bucket.items.filter(i => !isHubItem(i));
    const hub = bucket.items.filter(i => isHubItem(i));
    // Keep a category only when ≥2 non-hub pages remain — a 0/1-item category after
    // pulling out hubs is noise, so those pages become direct links too.
    if (nonHub.length >= 2) {
      out.push({ kind: "category", key: bucket.key, label: bucket.label, items: nonHub });
    } else {
      for (const item of nonHub) out.push({ kind: "link", item });
    }
    for (const item of hub) out.push({ kind: "link", item });
  }
  return out;
}

type PermissionChecker = (moduleName: string, action: string) => boolean;
type CategoryChecker = (category: string) => boolean;

/**
 * Check if a single nav item is accessible based on role + permissions
 */
function isItemAccessible(
  item: NavItem,
  userRole?: string,
  hasPermission?: PermissionChecker,
): boolean {
  // Admin bypasses all checks
  if (userRole === 'admin') return true;

  // Role-based gate (still enforced even with permissions). Normalizes the legacy
  // single-role shape (`'admin'`) and the doc69 Wave 0-C role-set shape
  // (`['admin', 'engineer']`) into one allow-list check.
  if (item.requiredRole) {
    const allowedRoles = Array.isArray(item.requiredRole) ? item.requiredRole : [item.requiredRole];
    if (!userRole || !allowedRoles.includes(userRole)) return false;
  }

  // Permission-based gate (if permission checker is provided and item has a mapping)
  if (hasPermission && item.requiredPermission) {
    return hasPermission(item.requiredPermission, 'canView');
  }

  // No permission mapping -> visible by default (backward compat)
  return true;
}

/**
 * Check if user has access to a navigation group
 */
export function hasAccessToGroup(
  groupId: string,
  userRole?: string,
  hasPermission?: PermissionChecker,
  hasAnyCategoryPermission?: CategoryChecker,
): boolean {
  const group = navGroups.find(g => g.id === groupId);
  if (!group) return false;

  // Admin bypasses
  if (userRole === 'admin') return true;

  // Legacy role gate
  if (group.requiredRole === 'admin' && userRole !== 'admin') {
    return false;
  }

  // If we have permission checkers, verify at least one child item is visible
  if (hasPermission) {
    return group.items.some(item => isItemAccessible(item, userRole, hasPermission));
  }

  return true;
}

/**
 * Check if user has access to a specific navigation item
 */
export function hasAccessToItem(
  href: string,
  userRole?: string,
  hasPermission?: PermissionChecker,
): boolean {
  for (const group of navGroups) {
    const item = group.items.find(i => i.href === href);
    if (item) {
      // Check group-level first
      if (group.requiredRole === 'admin' && userRole !== 'admin') {
        return false;
      }
      return isItemAccessible(item, userRole, hasPermission);
    }
  }
  return false;
}

/**
 * Get filtered navigation groups based on user role AND granular permissions.
 */
/**
 * doc 59 (nav-collapse) — leaf rows whose destination is now reached through a
 * consolidation hub AND whose RBAC gate == the hub's gate (verified: an toàn để ẩn
 * khỏi menu without any path-loss — route KHÔNG xoá, deep-link + ⌘K vẫn tới được).
 * Bỏ 1 href khỏi set này để hiện lại row đó. Chỉ ẩn 28 row gate-khớp; các row lệch-gate
 * (/scheduled-reports, /robot-model-health, /causal-graph, /products…) GIỮ trong menu.
 */
const COLLAPSED_INTO_HUB: ReadonlySet<string> = new Set([
  // doc 69 T6 — the 16 rows previously folded into /ai-studio (now retired/merged
  // into /ai-home) were REMOVED from this set: the AI rail is now the single
  // taxonomy (doc 69 B1.2) — folding its own rows into its own hub landing would
  // defeat that goal. All AI rows show directly in the rail again.
  // → /data-management (hub gate masterdata)
  "/master-data", "/operator-badges", "/master-data-audit", "/data-quality", "/component-library",
  // → /product-workspace (hub gate history_view)
  "/golden-samples", "/defect-catalog", "/measurement-point-health", "/product-comparison",
  // → /reporting-studio (hub gate reports_view). GIỮ /scheduled-reports (gate reports_schedule ≠ hub)
  "/report-builder", "/pdf-reports", "/powerpoint-export",
  // doc 63 AUD-N4 — /data-comparison đã được Comparison Studio GỘP (doc 46 FE-W3.3);
  // gate khớp (analytics_advanced) → ẩn row near-dup khỏi rail; ⌘K vẫn tìm được (IA-09).
  "/data-comparison",
  // doc 68 §2 (Navbar Phương án B, ĐẢO doc 67 W5) — 4 dashboard tổng hợp
  // (/command-center · /dashboard · /corporate-dashboard · /executive) TRỞ LẠI rail,
  // tổ chức dưới group "Tổng quan" thành landing (/control-tower) + 2 sub-nhóm có tiêu đề
  // ("Bảng tổng hợp" / "Vận hành") qua cơ chế `sections`. Không còn ẩn khỏi rail.
  // doc 65 PRO-100 nợ-nhỏ — /oee-dashboard là REDIRECT thuần về /device-monitor?tab=oee
  // (QA4F-1) nhưng vẫn còn row rail riêng → "2 đường vào 1 nội dung" + sidebar-active lệch
  // (finding vòng xác nhận). Gate khớp hub → ẩn row; ⌘K vẫn tìm được.
  "/oee-dashboard",
]);

/** Remove collapsed rows from every group, then drop groups left empty. */
function collapseNavGroups(groups: NavGroup[]): NavGroup[] {
  return groups
    .map(group => ({ ...group, items: group.items.filter(item => !COLLAPSED_INTO_HUB.has(item.href)) }))
    .filter(group => group.items.length > 0);
}

/** Apply role/permission filtering to an already-decided set of groups (collapsed or not). */
function applyRbacFilter(
  base: NavGroup[],
  userRole?: string,
  hasPermission?: PermissionChecker,
  hasAnyCategoryPermission?: CategoryChecker,
): NavGroup[] {
  // Admin sees everything in `base`.
  if (userRole === 'admin') return base;

  return base
    .filter(group => {
      // Legacy role gate
      if (group.requiredRole === 'admin' && userRole !== 'admin') {
        return false;
      }
      // Quick category-level check if available
      if (hasAnyCategoryPermission && group.permissionCategory) {
        return hasAnyCategoryPermission(group.permissionCategory);
      }
      return true;
    })
    .map(group => ({
      ...group,
      items: group.items.filter(item =>
        isItemAccessible(item, userRole, hasPermission),
      ),
    }))
    .filter(group => group.items.length > 0);
}

export function getFilteredNavGroups(
  userRole?: string,
  hasPermission?: PermissionChecker,
  hasAnyCategoryPermission?: CategoryChecker,
): NavGroup[] {
  // Sidebar view: rows folded into consolidation hubs are removed.
  return applyRbacFilter(collapseNavGroups(navGroups), userRole, hasPermission, hasAnyCategoryPermission);
}

/**
 * doc 63 (AUD-05 / IA-09) — SEARCH index for the ⌘K command palette. Identical
 * role/permission filtering to getFilteredNavGroups but WITHOUT collapseNavGroups: the
 * 28 rows folded into consolidation hubs (COLLAPSED_INTO_HUB) stay searchable, so a page
 * hidden from the sidebar is still reachable by name (Nielsen H7). Only the command palette
 * consumes this fuller set; the rail keeps using the collapsed getFilteredNavGroups.
 */
export function getSearchNavGroups(
  userRole?: string,
  hasPermission?: PermissionChecker,
  hasAnyCategoryPermission?: CategoryChecker,
): NavGroup[] {
  return applyRbacFilter(navGroups, userRole, hasPermission, hasAnyCategoryPermission);
}