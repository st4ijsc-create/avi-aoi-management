/**
 * Module Registry - Shared definition of all system modules
 * 
 * Đây là nguồn duy nhất (single source of truth) cho danh sách module hệ thống.
 * Được dùng bởi cả server (export, license enforcement) và client (UI gating).
 * 
 * Mỗi module tương ứng với 1 nhóm chức năng trong navigation sidebar.
 * Module code sẽ được đồng bộ với License Server qua file export JSON.
 */

/** Chức năng chi tiết bên trong mỗi module */
export interface ModuleFeature {
  /** Mã chức năng duy nhất, e.g. "DASHBOARD_VIEW" */
  code: string;
  /** Tên hiển thị */
  name: string;
  /** Loại feature: boolean (bật/tắt), limit (giới hạn số), tier (cấp bậc) */
  featureType: "boolean" | "limit" | "tier";
  /** Giá trị mặc định: "true"/"false" cho boolean, số cho limit */
  defaultValue: string;
}

export interface SystemModule {
  /** Mã module duy nhất - dùng để mapping với license server */
  code: string;
  /** Tên hiển thị */
  name: string;
  /** Mô tả chức năng */
  description: string;
  /** Phiên bản module */
  version: string;
  /** Module core luôn được bao gồm (không cần license) */
  isCore: boolean;
  /** Danh sách route paths thuộc module này */
  routes: string[];
  /** Danh sách permission categories liên quan */
  permissionCategories: string[];
  /** Danh sách chức năng chi tiết bên trong module */
  features: ModuleFeature[];
  /** Navigation group ID tương ứng */
  navGroupId?: string;
}

/** Format feature cho export (đơn giản hóa) */
export interface ExportModuleFeature {
  code: string;
  name: string;
  featureType: string;
  defaultValue: string;
}

/** Format module cho export (đơn giản hóa) */
export interface ExportModule {
  code: string;
  name: string;
  isCore: boolean;
  features: ExportModuleFeature[];
}

/**
 * Danh sách tất cả system modules
 * 
 * Module `isCore: true` luôn hoạt động kể cả khi không có license.
 * Module `isCore: false` chỉ hoạt động khi license có chứa module code tương ứng.
 */
export const SYSTEM_MODULES: SystemModule[] = [
  // ─── CORE MODULES (luôn bao gồm) ──────────────────────
  {
    code: "CORE_AUTH",
    name: "Authentication & Authorization",
    description: "Đăng nhập, phân quyền, quản lý phiên, 2FA, hồ sơ cá nhân",
    version: "1.0.0",
    isCore: true,
    routes: ["/login", "/setup", "/setup-admin", "/profile", "/change-password"],
    permissionCategories: [],
    features: [],
    navGroupId: undefined,
  },
  {
    code: "CORE_DASHBOARD",
    name: "Dashboard",
    description: "Bảng điều khiển chính, drill-down analysis, custom dashboard, templates, marketplace",
    version: "1.0.0",
    isCore: true,
    routes: ["/", "/dashboard", "/drill-down", "/custom-dashboard", "/dashboard-templates", "/template-marketplace", "/dashboard-marketplace"],
    permissionCategories: ["dashboard"],
    features: [
      { code: "DASHBOARD_VIEW", name: "Xem Dashboard", featureType: "boolean", defaultValue: "true" },
      { code: "DASHBOARD_WIDGETS", name: "Quản lý Widget", featureType: "boolean", defaultValue: "true" },
      { code: "DASHBOARD_DRILLDOWN", name: "Drill-Down Chi tiết", featureType: "boolean", defaultValue: "true" },
      { code: "DASHBOARD_TEMPLATES", name: "Mẫu Dashboard", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "dashboard",
  },
  {
    code: "CORE_SETTINGS",
    name: "General Settings",
    description: "Cài đặt chung hệ thống, cấu hình hệ thống, email, cache, ca làm việc, công đoạn",
    version: "1.0.0",
    isCore: true,
    routes: ["/settings", "/system-config"],
    permissionCategories: ["settings"],
    features: [
      { code: "SETTINGS_VIEW", name: "Xem Cài đặt", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_FACTORY", name: "QL Nhà máy", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_ALERTS", name: "QL Cảnh báo", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_SHIFTS", name: "QL Ca làm việc", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_STAGES", name: "QL Công đoạn", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_YIELD_THRESHOLDS", name: "Ngưỡng Yield", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_SMTP", name: "Cấu hình Email", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_NOTIFICATION_SOUNDS", name: "Âm thanh Thông báo", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_CACHE", name: "Quản lý Cache", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "settings",
  },
  {
    code: "CORE_ADMIN",
    name: "System Administration",
    description: "Quản trị hệ thống, quản lý user, role, audit, license, backup, sessions, user assignments",
    version: "1.0.0",
    isCore: true,
    routes: ["/admin", "/users", "/role-builder", "/enhanced-audit", "/audit-logs", "/api-docs", "/user-guide", "/license", "/backup-restore", "/sessions", "/user-assignments"],
    permissionCategories: ["admin"],
    features: [
      { code: "ADMIN_USERS", name: "QL Người dùng", featureType: "boolean", defaultValue: "true" },
      { code: "ADMIN_PERMISSIONS", name: "QL Phân quyền", featureType: "boolean", defaultValue: "true" },
      { code: "ADMIN_ROLES", name: "QL Vai trò", featureType: "boolean", defaultValue: "true" },
      { code: "ADMIN_SYSTEM", name: "Cấu hình Hệ thống", featureType: "boolean", defaultValue: "true" },
      { code: "ADMIN_AUDIT", name: "Nhật ký Audit", featureType: "boolean", defaultValue: "true" },
      { code: "ADMIN_SESSIONS", name: "QL Phiên đăng nhập", featureType: "boolean", defaultValue: "true" },
      { code: "ADMIN_2FA", name: "QL Xác thực 2 bước", featureType: "boolean", defaultValue: "true" },
      { code: "ADMIN_BACKUP", name: "Sao lưu & Phục hồi", featureType: "boolean", defaultValue: "true" },
      { code: "ADMIN_IMPORT_EXPORT", name: "Nhập/Xuất dữ liệu", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "admin",
  },

  // ─── OPTIONAL MODULES (cần license) ────────────────────
  {
    code: "MOD_CORPORATE",
    name: "Corporate Management",
    description: "Quản lý doanh nghiệp đa nhà máy, cấu trúc tổ chức, tổng quan corporate",
    version: "1.0.0",
    isCore: false,
    routes: ["/corporate-dashboard", "/corporate-layout", "/corporate-management"],
    permissionCategories: ["dashboard"],
    features: [
      { code: "DASHBOARD_CORPORATE", name: "Dashboard Tập đoàn", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "corporate",
  },
  {
    code: "MOD_MONITORING",
    name: "Machine Monitoring",
    description: "Giám sát máy, MQTT dashboard, OEE, sức khỏe thiết bị, bulletin, quản lý workstation",
    version: "1.0.0",
    isCore: false,
    routes: [
      "/machine-status", "/machine-registration",
      "/mqtt-dashboard", "/mqtt-clients", "/mqtt-topics", "/mqtt-replay",
      "/mqtt-profiles", "/mqtt-bulletin",
      "/oee-dashboard", "/machine-health",
      "/workstation-management",
    ],
    permissionCategories: ["machine_monitoring", "mqtt", "analytics"],
    features: [
      // Machine Monitoring
      { code: "MACHINE_STATUS", name: "Trạng thái Máy", featureType: "boolean", defaultValue: "true" },
      { code: "MACHINE_ALERTS", name: "Cảnh báo Máy", featureType: "boolean", defaultValue: "true" },
      { code: "MACHINE_DOWNTIME", name: "Quản lý Downtime", featureType: "boolean", defaultValue: "true" },
      // MQTT
      { code: "MQTT_VIEW", name: "Xem MQTT Status", featureType: "boolean", defaultValue: "true" },
      { code: "MQTT_CONFIGURE", name: "Cấu hình MQTT", featureType: "boolean", defaultValue: "true" },
      { code: "MQTT_LOGS", name: "Xem Log MQTT", featureType: "boolean", defaultValue: "true" },
      { code: "MQTT_PROFILES", name: "MQTT Profile", featureType: "boolean", defaultValue: "true" },
      { code: "MQTT_ASSIGNMENTS", name: "MQTT Gán Profile", featureType: "boolean", defaultValue: "true" },
      { code: "MQTT_MONITORING", name: "Giám sát Kết nối", featureType: "boolean", defaultValue: "true" },
      { code: "MQTT_BULLETIN", name: "MQTT Bulletin", featureType: "boolean", defaultValue: "true" },
      { code: "MQTT_REPLAY", name: "MQTT Replay", featureType: "boolean", defaultValue: "true" },
      // Analytics (monitoring-related)
      { code: "ANALYTICS_OEE", name: "Dashboard OEE", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_MACHINE_HEALTH", name: "Sức khỏe Máy", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_WORKSTATION", name: "Analytics Trạm Làm việc", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "monitoring",
  },
  {
    code: "MOD_ALERTS",
    name: "Alert Management",
    description: "Cảnh báo, quy tắc cảnh báo MQTT, cảnh báo dự đoán, mục tiêu OEE",
    version: "1.0.0",
    isCore: false,
    routes: ["/alerts", "/mqtt-alerts", "/predictive-alerts", "/oee-target-settings"],
    permissionCategories: ["mqtt", "analytics"],
    features: [
      { code: "MQTT_ALERTS", name: "Cảnh báo MQTT", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_PREDICTIVE_ALERTS", name: "Cảnh báo Dự đoán", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_OEE_TARGETS", name: "Cấu hình Mục tiêu OEE", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "alerts",
  },
  {
    code: "MOD_PRODUCTION",
    name: "Production Management",
    description: "Lệnh sản xuất, lịch sử kiểm tra, AOI packages, lịch trình xuất dữ liệu, quản lý quy trình",
    version: "1.0.0",
    isCore: false,
    routes: ["/production-orders", "/history", "/aoi-packages", "/history-export-scheduling", "/production-scheduling", "/inspection", "/process-management"],
    permissionCategories: ["production", "history", "reports"],
    features: [
      // Production
      { code: "PRODUCTION_ORDERS", name: "QL Đơn sản xuất", featureType: "boolean", defaultValue: "true" },
      { code: "PRODUCTION_LAYOUT", name: "Bố trí Xưởng", featureType: "boolean", defaultValue: "true" },
      { code: "PRODUCTION_LINE_ASSIGNMENTS", name: "Gán SP-Dây chuyền", featureType: "boolean", defaultValue: "true" },
      // History
      { code: "HISTORY_VIEW", name: "Xem Lịch sử", featureType: "boolean", defaultValue: "true" },
      { code: "HISTORY_DETAIL", name: "Xem Chi tiết Inspection", featureType: "boolean", defaultValue: "true" },
      { code: "HISTORY_EXPORT", name: "Xuất Lịch sử", featureType: "boolean", defaultValue: "true" },
      { code: "HISTORY_DELETE", name: "Xóa Lịch sử", featureType: "boolean", defaultValue: "true" },
      { code: "HISTORY_CORRECT", name: "Sửa kết quả Inspection", featureType: "boolean", defaultValue: "true" },
      { code: "HISTORY_AI_ANALYSIS", name: "Phân tích AI", featureType: "boolean", defaultValue: "true" },
      // Reports
      { code: "REPORTS_VIEW", name: "Xem Báo cáo", featureType: "boolean", defaultValue: "true" },
      { code: "REPORTS_CREATE", name: "Tạo Báo cáo", featureType: "boolean", defaultValue: "true" },
      { code: "REPORTS_SCHEDULE", name: "Lịch trình Báo cáo", featureType: "boolean", defaultValue: "true" },
      { code: "REPORTS_EXPORT", name: "Xuất Báo cáo", featureType: "boolean", defaultValue: "true" },
      { code: "REPORTS_TEMPLATES", name: "Mẫu Báo cáo", featureType: "boolean", defaultValue: "true" },
      // Limits
      { code: "MAX_PRODUCTION_ORDERS", name: "Giới hạn Đơn SX", featureType: "limit", defaultValue: "9999" },
      { code: "MAX_HISTORY_EXPORT_ROWS", name: "Giới hạn Xuất Lịch sử", featureType: "limit", defaultValue: "50000" },
    ],
    navGroupId: "production",
  },
  {
    code: "MOD_ANALYTICS",
    name: "Analytics & Reporting",
    description: "Báo cáo, SPC analysis, quality gates, pareto, heatmap, root cause, report builder, annotations",
    version: "1.0.0",
    isCore: false,
    routes: [
      "/reports", "/scheduled-reports", "/category-analytics",
      "/spc-analysis", "/spc-advanced", "/correlation-analysis",
      "/quality-gates", "/pareto-analysis", "/quality-gate-templates",
      "/annotation-statistics", "/annotation-comparison",
      "/defect-heatmap", "/defect-prediction", "/root-cause-analysis",
      "/pdf-reports", "/data-comparison", "/report-builder",
      "/powerpoint-export", "/enhanced-scheduled-reports",
      "/product-comparison", "/ai-performance", "/test-annotation",
    ],
    permissionCategories: ["analytics", "reports", "annotations"],
    features: [
      // Analytics
      { code: "ANALYTICS_VIEW", name: "Xem Analytics", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_ADVANCED", name: "Phân tích Nâng cao", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_SPC", name: "Phân tích SPC", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_CATEGORY", name: "Analytics theo Loại SP", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_PRODUCT_COMPARISON", name: "So sánh Sản phẩm", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_DEFECT_HEATMAP", name: "Heatmap Lỗi", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_DEFECT_PREDICTION", name: "Dự đoán Lỗi", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_ROOT_CAUSE", name: "Phân tích Nguyên nhân gốc", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_AI_PERFORMANCE", name: "Hiệu suất AI", featureType: "boolean", defaultValue: "true" },
      // Annotations
      { code: "ANNOTATION_VIEW", name: "Xem Annotation", featureType: "boolean", defaultValue: "true" },
      { code: "ANNOTATION_CREATE", name: "Tạo Annotation", featureType: "boolean", defaultValue: "true" },
      { code: "ANNOTATION_TEMPLATES", name: "Mẫu Annotation", featureType: "boolean", defaultValue: "true" },
      { code: "ANNOTATION_EXPORT", name: "Xuất/Nhập Annotation", featureType: "boolean", defaultValue: "true" },
      { code: "ANNOTATION_AI", name: "AI Annotation", featureType: "boolean", defaultValue: "true" },
      // Limits
      { code: "MAX_REPORT_ROWS", name: "Giới hạn Dòng Báo cáo", featureType: "limit", defaultValue: "100000" },
      { code: "MAX_SCHEDULED_REPORTS", name: "Giới hạn Báo cáo Tự động", featureType: "limit", defaultValue: "50" },
    ],
    navGroupId: "analytics",
  },
  {
    code: "MOD_DATA_MANAGEMENT",
    name: "Data Management",
    description: "Quản lý sản phẩm, product mapping, factory layout, cài đặt dữ liệu, import/export, thiết bị, điểm đo, workstation",
    version: "1.0.0",
    isCore: false,
    routes: ["/products", "/product-mapping", "/layout", "/datasettings", "/import-export"],
    permissionCategories: ["settings"],
    features: [
      { code: "SETTINGS_PRODUCTS", name: "QL Sản phẩm", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_MACHINES", name: "QL Thiết bị", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_MEASUREMENT_POINTS", name: "QL Điểm đo", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_WORKSTATIONS", name: "QL Trạm Làm việc", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_PRODUCT_MAPPING", name: "Gán SP-Máy", featureType: "boolean", defaultValue: "true" },
      { code: "SETTINGS_PROCESS", name: "QL Quy trình", featureType: "boolean", defaultValue: "true" },
      // Limits
      { code: "MAX_PRODUCTS", name: "Giới hạn Sản phẩm", featureType: "limit", defaultValue: "9999" },
      { code: "MAX_MACHINES", name: "Giới hạn Thiết bị", featureType: "limit", defaultValue: "999" },
    ],
    navGroupId: "data-management",
  },
];

/**
 * Module codes cho tất cả core modules
 */
export const CORE_MODULE_CODES = SYSTEM_MODULES
  .filter(m => m.isCore)
  .map(m => m.code);

/**
 * Module codes cho tất cả optional modules
 */
export const OPTIONAL_MODULE_CODES = SYSTEM_MODULES
  .filter(m => !m.isCore)
  .map(m => m.code);

/**
 * Tất cả module codes
 */
export const ALL_MODULE_CODES = SYSTEM_MODULES.map(m => m.code);

/**
 * Tra cứu module theo route path
 */
export function getModuleByRoute(routePath: string): SystemModule | undefined {
  return SYSTEM_MODULES.find(m => m.routes.includes(routePath));
}

/**
 * Tra cứu module theo code
 */
export function getModuleByCode(code: string): SystemModule | undefined {
  return SYSTEM_MODULES.find(m => m.code === code);
}

/**
 * Tra cứu module theo nav group ID
 */
export function getModuleByNavGroup(navGroupId: string): SystemModule | undefined {
  return SYSTEM_MODULES.find(m => m.navGroupId === navGroupId);
}

/**
 * Kiểm tra route có được phép truy cập với danh sách module đã được cấp phép không
 * Core modules luôn được phép.
 */
export function isRouteAllowed(routePath: string, allowedModuleCodes: string[]): boolean {
  const module = getModuleByRoute(routePath);
  if (!module) return true; // Route không thuộc module nào -> cho phép
  if (module.isCore) return true; // Core module -> luôn cho phép
  return allowedModuleCodes.includes(module.code);
}

/**
 * Lọc danh sách routes theo license modules
 */
export function filterAllowedRoutes(routes: string[], allowedModuleCodes: string[]): string[] {
  return routes.filter(r => isRouteAllowed(r, allowedModuleCodes));
}

/**
 * Chuyển đổi SYSTEM_MODULES sang format export cho License Server
 */
export function toExportFormat(productCode: string, appVersion: string = "1.0.0") {
  return {
    productCode,
    version: appVersion,
    modules: SYSTEM_MODULES.map(m => ({
      code: m.code,
      name: m.name,
      isCore: m.isCore,
      features: m.features.map(f => ({
        code: f.code,
        name: f.name,
        featureType: f.featureType,
        defaultValue: f.defaultValue,
      })),
    })),
  };
}
