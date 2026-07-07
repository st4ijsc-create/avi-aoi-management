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
 * Danh sách seed (nguồn) của tất cả system modules.
 *
 * Module `isCore: true` luôn hoạt động kể cả khi không có license.
 * Module `isCore: false` chỉ hoạt động khi license có chứa module code tương ứng.
 *
 * U4b (doc 21 §6 / G-8): đây là SEED cho registry data-driven bên dưới. Mỗi manifest
 * được đăng ký qua `registerModule` khi load, nên `SYSTEM_MODULES` được DERIVE từ
 * registry (backward-compatible). Một module mới `registerModule(manifest)` thay vì
 * sửa mảng này (register-and-go). Thứ tự đăng ký == thứ tự khai báo ở đây.
 */
const SEED_MODULES: SystemModule[] = [
  // ─── CORE MODULES (luôn bao gồm) ──────────────────────
  {
    code: "CORE_AUTH",
    name: "Authentication & Authorization",
    description: "Đăng nhập, phân quyền, quản lý phiên, 2FA, hồ sơ cá nhân",
    version: "1.0.0",
    isCore: true,
    routes: [
      "/login", "/setup", "/setup-admin", "/profile", "/change-password",
      // doc 36 — personal ("Me") read-open self-pages belong to the always-on CORE_AUTH app.
      "/inbox", "/today", "/operator", "/maintenance-home", "/supervisor-home",
      "/viewer-home", "/request-role", "/about-system",
    ],
    permissionCategories: [],
    features: [],
    navGroupId: "me",
  },
  {
    code: "CORE_DASHBOARD",
    name: "Dashboard",
    description: "Bảng điều khiển chính, drill-down analysis, custom dashboard, templates, marketplace",
    version: "1.0.0",
    isCore: true,
    routes: [
      "/", "/dashboard", "/drill-down", "/command-center", "/ops-console", "/andon",
      "/predictive-alerts", "/dashboard-center",
      "/custom-dashboard", "/dashboard-templates", "/template-marketplace", "/dashboard-marketplace",
    ],
    permissionCategories: ["dashboard"],
    features: [
      { code: "DASHBOARD_VIEW", name: "Xem Dashboard", featureType: "boolean", defaultValue: "true" },
      { code: "DASHBOARD_WIDGETS", name: "Quản lý Widget", featureType: "boolean", defaultValue: "true" },
      { code: "DASHBOARD_DRILLDOWN", name: "Drill-Down Chi tiết", featureType: "boolean", defaultValue: "true" },
      { code: "DASHBOARD_TEMPLATES", name: "Mẫu Dashboard", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "overview",
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
    routes: [
      "/admin", "/admin-home", "/users", "/role-builder",
      "/enhanced-audit", "/audit-logs", "/command-audit",
      "/api-docs", "/api-keys", "/user-guide", "/license",
      "/backup-restore", "/sessions", "/user-assignments",
      "/admin-setting", "/import-export", "/synapse-platform",
      // doc 36 W3 — the modules marketplace is the UPSELL target; keep it core so a
      // license-blocked user can always reach it to upgrade (never a lock-out trap).
      "/modules",
    ],
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
      // doc 36 — full "Giám sát máy" app surface. Absorbs alerts (D3: MOD_ALERTS folded here).
      // doc 39 Wave 4 — /connectivity is the MQTT/UNS hub (the /mqtt-* + /uns-mapping routes
      // below now redirect into its tabs). It MUST be owned here so the hub nav row resolves
      // to the Devices app under scopeGroupsToApp (otherwise it's silently dropped).
      "/connectivity",
      "/device-monitor", "/machine-status", "/machine-registration",
      "/machine-onboarding", "/aoi-onboarding",
      "/mqtt-dashboard", "/mqtt-clients", "/mqtt-topics", "/mqtt-replay",
      "/mqtt-profiles", "/mqtt-bulletin", "/mqtt-ng-rate", "/mqtt-alerts",
      "/oee-dashboard", "/machine-health", "/factory-live-map", "/field-devices",
      "/device-adapters", "/uns-mapping", "/hot-folders", "/edge-nodes",
      "/system-health", "/digital-twin-center",
      "/technician-copilot", "/work-orders",
      "/alerts", "/monitoring-setting",
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
      { code: "MQTT_NG_RATE_THRESHOLD", name: "Ngưỡng NG Rate MQTT", featureType: "boolean", defaultValue: "true" },
      { code: "MQTT_REPLAY", name: "MQTT Replay", featureType: "boolean", defaultValue: "true" },
      // Analytics (monitoring-related)
      { code: "ANALYTICS_OEE", name: "Dashboard OEE", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_MACHINE_HEALTH", name: "Sức khỏe Máy", featureType: "boolean", defaultValue: "true" },
      { code: "ANALYTICS_WORKSTATION", name: "Analytics Trạm Làm việc", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "devices",
  },
  {
    code: "MOD_ALERTS",
    name: "Alert Management (deprecated)",
    description: "DEPRECATED (doc 36 D3): gộp vào MOD_MONITORING (alerts/mqtt-alerts) + MOD_ANALYTICS (oee-target-settings). Giữ đăng ký để tương thích license cũ; không sở hữu route nào.",
    version: "1.0.0",
    isCore: false,
    routes: [],
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
    routes: [
      // doc 36 — full "Sản xuất (MES)" app. Absorbs MES/twin/trace + feeder/routing (from devices) + product-comparison (from analytics) + bom (from OT).
      "/production-dashboard", "/mes-control-tower", "/wip-dashboard",
      "/traceability", "/digital-twin",
      "/history", "/inspection", "/aoi-packages", "/product-comparison",
      "/production-orders", "/production-scheduling", "/production-signoff",
      "/history-export-scheduling", "/bom-management",
      "/routing-master", "/feeder-verify",
    ],
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
      // doc 36 D1 — quality routes (spc/pareto/gates/annotation/heatmap/prediction/root-cause/
      // nonconformance/threshold-approvals) MOVED to MOD_QUALITY. product-comparison → MOD_PRODUCTION.
      // engineering-changes (ECN) → MOD_ENGINEERING. This app = reporting + cross-analysis + energy.
      "/reports", "/scheduled-reports", "/enhanced-scheduled-reports",
      "/report-builder", "/category-analytics", "/correlation-analysis",
      "/data-comparison", "/realtime-report",
      "/energy-analytics", "/carbon-dashboard",
      "/pdf-reports", "/powerpoint-export",
      "/oee-target-settings", "/analytics-setting",
      // NOTE: AI routes (/ai-performance, /ai-batch-jobs, /ai-ab-testing,
      // /ai-monitoring, /model-versions, ...) đã chuyển sang module MOD_AI.
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
    routes: [
      // doc 36 — master-data surface of the "Quản trị & Cấu hình" app (D5). import-export → CORE_ADMIN.
      "/master-data", "/operator-badges", "/component-library",
      "/products", "/product-onboarding", "/product-mapping",
      "/layout", "/workstation-management", "/process-management", "/datasettings",
    ],
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
  {
    code: "MOD_AI",
    name: "AI & Local Intelligence",
    description: "Hệ AI cục bộ (local-first): AI Hub, Copilot/Chat, Vision Lab, GGUF/ONNX models, image search, quality-gate AI, active learning, time-series, knowledge base (RAG)",
    version: "1.0.0",
    isCore: false,
    routes: [
      "/ai-hub", "/ai-chat", "/management-insight", "/ai-brain",
      "/ai-quality-gate", "/ai-active-learning",
      "/ai-image-search", "/ai-reports", "/ai-time-series", "/ai-data-processing",
      "/ai-performance", "/ai-batch-jobs", "/ai-ab-testing", "/ai-monitoring",
      "/ai-models", "/model-versions", "/ai-settings", "/robot-model-health",
      "/ai-inspection-analytics", "/ai-advanced-vision-lab",
      "/ai-gguf-models", "/ai-local-kb", "/mask-annotation",
      // doc 22 P3 — AI cockpits that previously escaped the registry (license bypass).
      "/anomaly-banks", "/causal-graph",
    ],
    permissionCategories: ["analytics"],
    features: [
      { code: "AI_HUB", name: "AI Hub", featureType: "boolean", defaultValue: "true" },
      { code: "AI_CHAT_COPILOT", name: "AI Chat & Copilot", featureType: "boolean", defaultValue: "true" },
      { code: "AI_VISION_LAB", name: "Advanced Vision Lab", featureType: "boolean", defaultValue: "true" },
      { code: "AI_IMAGE_SEARCH", name: "Tìm kiếm ảnh AI", featureType: "boolean", defaultValue: "true" },
      { code: "AI_QUALITY_GATE", name: "Quality Gate AI", featureType: "boolean", defaultValue: "true" },
      { code: "AI_ACTIVE_LEARNING", name: "Active Learning", featureType: "boolean", defaultValue: "true" },
      { code: "AI_TIME_SERIES", name: "Time-Series AI", featureType: "boolean", defaultValue: "true" },
      { code: "AI_MODEL_MANAGEMENT", name: "Quản lý Model & Versions", featureType: "boolean", defaultValue: "true" },
      { code: "AI_BATCH_INFERENCE", name: "Batch Inference", featureType: "boolean", defaultValue: "true" },
      { code: "AI_MONITORING", name: "Giám sát Model (drift)", featureType: "boolean", defaultValue: "true" },
      { code: "AI_LOCAL_KB", name: "Knowledge Base cục bộ (RAG)", featureType: "boolean", defaultValue: "true" },
      { code: "AI_GGUF_LOCAL_LLM", name: "Local LLM (GGUF)", featureType: "boolean", defaultValue: "true" },
      // doc 22 P3 — feature entries clarifying the newly-gated AI cockpits.
      { code: "AI_ANOMALY_BANKS", name: "Anomaly Banks", featureType: "boolean", defaultValue: "true" },
      { code: "AI_CAUSAL_GRAPH", name: "Causal Graph Editor", featureType: "boolean", defaultValue: "true" },
      // Limits
      { code: "MAX_AI_MODELS", name: "Giới hạn Model AI", featureType: "limit", defaultValue: "999" },
      { code: "MAX_AI_BATCH_JOBS", name: "Giới hạn Batch Job", featureType: "limit", defaultValue: "100" },
    ],
    navGroupId: "ai",
  },
  {
    code: "MOD_OT_CONTROL",
    name: "OT & Machine Control",
    description: "Kết nối & điều khiển thiết bị OT: Andon, device adapters (OPC-UA/Modbus/S7/...), recipes, interlock an toàn, command audit, BOM/material. Mọi lệnh ghi đi qua HITL + interlock + audit append-only.",
    version: "1.0.0",
    isCore: false,
    routes: [
      // doc 36 D2 — authoring/programming (engineering/recipes/ir/pou/copilot/orchestration) SPLIT
      // to MOD_ENGINEERING. This module keeps the DEVICE-CONTROL / safety / fleet / twin-cell surface.
      // (andon→CORE_DASHBOARD, device-adapters→MOD_MONITORING, command-audit→CORE_ADMIN, bom→MOD_PRODUCTION.)
      "/interlock-rules", "/fleet-orchestration", "/safety-workforce",
      "/equipment-standards", "/equipment-integration",
      "/factory-floor-editor", "/control-plane", "/robot-control",
      "/rf-test-cell", "/cell-twin",
    ],
    permissionCategories: ["machine_control", "andon", "interlock", "mes_bom"],
    features: [
      { code: "OT_ANDON", name: "Andon Board", featureType: "boolean", defaultValue: "true" },
      { code: "OT_DEVICE_ADAPTERS", name: "Device Adapters", featureType: "boolean", defaultValue: "true" },
      { code: "OT_RECIPES", name: "Recipe Management", featureType: "boolean", defaultValue: "true" },
      { code: "OT_INTERLOCK", name: "Interlock Rules", featureType: "boolean", defaultValue: "true" },
      { code: "OT_COMMAND_AUDIT", name: "Command Audit Log", featureType: "boolean", defaultValue: "true" },
      { code: "OT_MES_BOM", name: "BOM/Material Management", featureType: "boolean", defaultValue: "true" },
      // doc 22 P3 — feature entries clarifying the newly-gated automation cockpits.
      { code: "OT_FLEET_ORCHESTRATION", name: "Fleet Orchestration", featureType: "boolean", defaultValue: "true" },
      { code: "OT_SAFETY_WORKFORCE", name: "Safety & Workforce", featureType: "boolean", defaultValue: "true" },
      { code: "OT_ENGINEERING_WORKSPACE", name: "Engineering Workspace", featureType: "boolean", defaultValue: "true" },
      { code: "OT_ORCHESTRATION_STUDIO", name: "Orchestration Studio", featureType: "boolean", defaultValue: "true" },
      { code: "OT_CELL_TWIN", name: "Cell Twin / RF Test Cell", featureType: "boolean", defaultValue: "true" },
      // OT control là quyền nhạy cảm — mặc định TẮT, license phải bật tường minh
      { code: "OT_DEVICE_WRITE", name: "Cho phép ghi lệnh thiết bị (nhạy cảm)", featureType: "boolean", defaultValue: "false" },
      { code: "MAX_DEVICE_ADAPTERS", name: "Giới hạn Device Adapter", featureType: "limit", defaultValue: "500" },
    ],
    navGroupId: "engineering",
  },
  {
    code: "MOD_FEDERATION",
    name: "Multi-Site Federation",
    description: "Đăng ký & tổng hợp nhiều site (đa nhà máy): sites registry, enrollment, probe read-only; cross-site roll-up dashboard (F1+). Core CHỈ đọc — không điều khiển site.",
    version: "1.0.0",
    isCore: false,
    // doc 36 W3 — /modules moved to CORE_ADMIN (always-reachable upsell page).
    routes: ["/sites", "/federation-dashboard"],
    permissionCategories: ["admin"],
    features: [
      { code: "FEDERATION_SITES", name: "Sites Registry & Enrollment", featureType: "boolean", defaultValue: "true" },
      { code: "FEDERATION_DASHBOARD", name: "Cross-Site Roll-up Dashboard", featureType: "boolean", defaultValue: "true" },
      { code: "FEDERATION_MARKETPLACE", name: "Modules Marketplace (WS5.4)", featureType: "boolean", defaultValue: "true" },
      { code: "MAX_FEDERATION_SITES", name: "Giới hạn số Site", featureType: "limit", defaultValue: "100" },
    ],
    navGroupId: "admin",
  },
  {
    // doc 36 D1 — Quality split out of MOD_ANALYTICS so it is sellable on its own
    // (khách chỉ cần QC không phải mua cả Analytics).
    code: "MOD_QUALITY",
    name: "Quality Management",
    description: "Kiểm soát chất lượng: Quality Cockpit (SPC/Pareto/Heatmap/Gates/Annotation), golden-sample, defect catalog, repair station, NCR/MRB, threshold approvals, RCA lỗi, dự đoán lỗi",
    version: "1.0.0",
    isCore: false,
    routes: [
      "/quality-cockpit", "/quality-home", "/quality-gate-templates",
      "/quality-gates", "/spc-analysis", "/spc-advanced", "/pareto-analysis",
      "/annotation-statistics", "/annotation-comparison",
      "/golden-samples", "/defect-catalog", "/measurement-point-health",
      "/repair-station", "/defect-heatmap", "/defect-prediction",
      "/root-cause-analysis", "/nonconformance", "/threshold-approvals",
    ],
    permissionCategories: ["history", "analytics", "annotations"],
    features: [
      { code: "QUALITY_COCKPIT", name: "Quality Cockpit", featureType: "boolean", defaultValue: "true" },
      { code: "QUALITY_SPC", name: "Phân tích SPC", featureType: "boolean", defaultValue: "true" },
      { code: "QUALITY_DEFECT_HEATMAP", name: "Heatmap Lỗi", featureType: "boolean", defaultValue: "true" },
      { code: "QUALITY_DEFECT_PREDICTION", name: "Dự đoán Lỗi", featureType: "boolean", defaultValue: "true" },
      { code: "QUALITY_ROOT_CAUSE", name: "Phân tích Nguyên nhân gốc", featureType: "boolean", defaultValue: "true" },
      { code: "QUALITY_GOLDEN_SAMPLE", name: "Golden Sample", featureType: "boolean", defaultValue: "true" },
      { code: "QUALITY_REPAIR_STATION", name: "Trạm Sửa chữa", featureType: "boolean", defaultValue: "true" },
      { code: "QUALITY_NCR_MRB", name: "NCR / MRB", featureType: "boolean", defaultValue: "true" },
      { code: "QUALITY_ANNOTATION", name: "Annotation", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "quality",
  },
  {
    // doc 36 D2 — Engineering/Programming split out of MOD_OT_CONTROL so the
    // authoring surface (lập trình) can be sold apart from sensitive OT device-control.
    code: "MOD_ENGINEERING",
    name: "Engineering & Programming",
    description: "Lập trình & tác giả tự động hóa: Engineering Workspace, IR Editor, IEC-61131 POU Studio, Recipe, Orchestration Studio, AI Programming Copilot, Engineering Change (ECN)",
    version: "1.0.0",
    isCore: false,
    routes: [
      "/engineering-home", "/engineering", "/engineering-changes", "/recipes",
      "/ir-editor", "/pou-studio", "/programming-copilot",
      "/orchestration-studio",
    ],
    permissionCategories: ["machine_control", "machine_monitoring", "masterdata"],
    features: [
      { code: "ENG_WORKSPACE", name: "Engineering Workspace", featureType: "boolean", defaultValue: "true" },
      { code: "ENG_IR_EDITOR", name: "IR Editor", featureType: "boolean", defaultValue: "true" },
      { code: "ENG_POU_STUDIO", name: "POU Studio (IEC-61131)", featureType: "boolean", defaultValue: "true" },
      { code: "ENG_RECIPES", name: "Recipe Management", featureType: "boolean", defaultValue: "true" },
      { code: "ENG_ORCHESTRATION_STUDIO", name: "Orchestration Studio", featureType: "boolean", defaultValue: "true" },
      { code: "ENG_PROGRAMMING_COPILOT", name: "AI Programming Copilot", featureType: "boolean", defaultValue: "true" },
      { code: "ENG_CHANGE_ECN", name: "Engineering Change (ECN)", featureType: "boolean", defaultValue: "true" },
    ],
    navGroupId: "engineering",
  },
];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * U4b (doc 21 §6 / G-8) — DATA-DRIVEN module registry (mirrors ot/driverRegistry).
 *
 * `SEED_MODULES` is registered through `registerModule` at load; `SYSTEM_MODULES` is
 * DERIVED from the registry so it stays backward-compatible (same array shape, same
 * order). A new module registers its manifest instead of editing the seed array
 * (register-and-go). Registering an existing `code` REPLACES that manifest in place
 * (order preserved) so callers/derived lists never see duplicates.
 * ════════════════════════════════════════════════════════════════════════════
 */
const moduleRegistry = new Map<string, SystemModule>();

/**
 * Register (or replace) a system-module manifest. Register-and-go: a new module needs
 * only this call — no edit to the seed array. Replacing an existing `code` keeps its
 * original position (Map preserves first-insertion order).
 */
export function registerModule(manifest: SystemModule): void {
  moduleRegistry.set(manifest.code, manifest);
}

// ── Seed the registry with every declared module (parity with the old array). ──
for (const m of SEED_MODULES) registerModule(m);

/**
 * Danh sách tất cả system modules (DERIVED từ registry — backward-compatible).
 *
 * LƯU Ý: đây là snapshot tại load-time để giữ nguyên hành vi cũ (một mảng const).
 * Module đăng ký thêm sau load hiển thị qua `listModules()`.
 */
export const SYSTEM_MODULES: SystemModule[] = [...moduleRegistry.values()];

/** Mọi module đã đăng ký (register-and-go view — phản ánh cả module thêm sau load). */
export function listModules(): SystemModule[] {
  return [...moduleRegistry.values()];
}

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
 * Tra cứu module theo route path (đọc live từ registry → thấy cả module đăng ký thêm).
 */
export function getModuleByRoute(routePath: string): SystemModule | undefined {
  // doc 36 — tolerate query strings so deep-link hrefs (e.g. "/quality-cockpit?tab=spc")
  // resolve to their owning module for license gating + app resolution.
  const path = (routePath || "").split("?")[0];
  return listModules().find(m => m.routes.includes(path));
}

/**
 * Tra cứu module theo code (đọc trực tiếp từ registry Map — O(1)).
 */
export function getModuleByCode(code: string): SystemModule | undefined {
  return moduleRegistry.get(code);
}

/**
 * Tra cứu module theo nav group ID (đọc live từ registry).
 */
export function getModuleByNavGroup(navGroupId: string): SystemModule | undefined {
  return listModules().find(m => m.navGroupId === navGroupId);
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
    modules: listModules().map(m => ({
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
