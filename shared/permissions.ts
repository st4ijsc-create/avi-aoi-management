/**
 * Permission Registry — nguồn DUY NHẤT (single source of truth) cho danh sách
 * `moduleName` hợp lệ của hệ RBAC + các alias.
 *
 * ─── Vì sao cần file này (doc 40 · Lan-P0 / DEV-02) ─────────────────────────────
 * Bảng `permissions` có 2 cột: `category` (pgEnum `permissioncategoryenum`) và
 * `moduleName` (varchar tự do). Việc kiểm quyền (`checkPermission` server /
 * `usePermissions` client) so khớp trên **`moduleName`**, KHÔNG phải `category`.
 *
 * Trước doc 40, hàng loạt gate gọi `requirePermission("machine_monitoring", ...)`.
 * Nhưng `machine_monitoring` chỉ là một **category** — không role nào được seed một
 * record có `moduleName === "machine_monitoring"`. Hệ quả: mọi gate đó chỉ admin
 * qua được (admin bypass), ≥12 route + hàng chục procedure thực tế admin-only —
 * đây là "permission ma".
 *
 * File này:
 *   1. Liệt kê `PERMISSION_MODULES` — mọi `moduleName` THẬT đã seed (tham chiếu +
 *      test CI "mọi requiredPermission phải tồn tại").
 *   2. `PERMISSION_MODULE_ALIASES` — ánh xạ tên-category-dùng-nhầm-làm-module về
 *      module thật (machine_monitoring → machine_status). Đây là lưới an toàn TRUNG
 *      TÂM: cả server (accessControl) lẫn client (usePermissions) resolve qua đây,
 *      nên MỌI gate `machine_monitoring` (kể cả ở router chưa sửa) tự động trỏ về
 *      `machine_status` — client và server LUÔN đồng bộ.
 *   3. `resolvePermissionModule` / `isValidPermissionModule` — helper dùng chung.
 *
 * Dùng bởi cả server và client (import qua `@shared/permissions`).
 */

/**
 * Toàn bộ `moduleName` hợp lệ (đã được seed ở ≥1 role trong
 * `permissionsRouter.DEFAULT_ROLE_PERMISSIONS`). Giữ đồng bộ với seed đó.
 */
export const PERMISSION_MODULES = [
  // Dashboard
  "dashboard_view",
  "dashboard_widgets",
  "dashboard_corporate",
  "dashboard_drilldown",
  "dashboard_templates",
  // History
  "history_view",
  "history_detail",
  "history_export",
  "history_delete",
  "history_correct",
  "history_ai_analysis",
  // Analytics
  "analytics_view",
  "analytics_advanced",
  "analytics_spc",
  "analytics_category",
  "analytics_product_comparison",
  "analytics_oee",
  "analytics_oee_targets",
  "analytics_machine_health",
  "analytics_defect_heatmap",
  "analytics_defect_prediction",
  "analytics_root_cause",
  "analytics_predictive_alerts",
  "analytics_workstation",
  "analytics_ai_performance",
  // Reports
  "reports_view",
  "reports_create",
  "reports_schedule",
  "reports_export",
  "reports_templates",
  // MQTT
  "mqtt_view",
  "mqtt_configure",
  "mqtt_logs",
  "mqtt_alerts",
  "mqtt_profiles",
  "mqtt_assignments",
  "mqtt_monitoring",
  "mqtt_bulletin",
  "mqtt_replay",
  // doc 56 Đ2a — approve/list-pending máy có thể mở cho non-admin (vd engineer) khi
  // cờ MACHINE_APPROVE_RBAC_OPEN_ENABLED=true; grant per-USER seed theo tiền lệ 0269.
  "machine_registration",
  // Settings
  "settings_view",
  "settings_factory",
  "settings_products",
  "settings_machines",
  "settings_alerts",
  "settings_measurement_points",
  "settings_workstations",
  "settings_shifts",
  "settings_stages",
  "settings_yield_thresholds",
  "settings_product_mapping",
  "settings_process",
  "settings_smtp",
  "settings_notification_sounds",
  "settings_cache",
  // Admin
  "admin_users",
  "admin_permissions",
  "admin_roles",
  "admin_system",
  "admin_audit",
  "admin_sessions",
  "admin_2fa",
  "admin_backup",
  "admin_import_export",
  // Production
  "production_orders",
  "production_layout",
  "production_line_assignments",
  // doc 40 Lan-P0 — quyền phiên sản xuất của operator (vào ca / tạm dừng / kết thúc
  // / bàn giao ca). Tách khỏi `production_orders` để operator KHÔNG cần quyền tạo
  // đơn sản xuất mới mở được ca của chính mình. Category: 'production'.
  "production_session",
  // Machine monitoring (moduleName THẬT — `machine_monitoring` chỉ là category)
  "machine_status",
  "machine_alerts",
  "machine_downtime",
  // Machine control (OT HITL)
  "machine_control",
  // Andon / Interlock / MES-BOM / Energy
  "andon",
  "interlock",
  "mes_bom",
  "energy",
  // Annotations
  "annotation_view",
  "annotation_create",
  "annotation_templates",
  "annotation_export",
  "annotation_ai",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

const PERMISSION_MODULE_SET: ReadonlySet<string> = new Set(PERMISSION_MODULES);

/**
 * Ánh xạ CÁC TÊN CATEGORY bị dùng nhầm làm `moduleName` → module THẬT tương ứng.
 *
 * `machine_monitoring` là category (xem `permissioncategoryenum`) nhưng bị dùng làm
 * moduleName ở nhiều gate. Resolve về `machine_status` (module xem-trạng-thái đã seed
 * cho MỌI role không-admin) → khôi phục hành vi "read-open trên machine_monitoring"
 * đúng như ý đồ thiết kế mà không cần migration.
 */
export const PERMISSION_MODULE_ALIASES: Readonly<Record<string, PermissionModule>> = {
  machine_monitoring: "machine_status",
};

/**
 * Resolve một `moduleName` về module thật: áp alias nếu có, ngược lại trả nguyên tên.
 * Dùng ở CẢ server (`checkPermission`) và client (`usePermissions.hasPermission`) để
 * hai phía luôn khớp module.
 */
export function resolvePermissionModule(moduleName: string): string {
  return PERMISSION_MODULE_ALIASES[moduleName] ?? moduleName;
}

/** `moduleName` có phải một module hợp lệ (sau khi áp alias) không. */
export function isValidPermissionModule(moduleName: string): boolean {
  return PERMISSION_MODULE_SET.has(resolvePermissionModule(moduleName));
}
