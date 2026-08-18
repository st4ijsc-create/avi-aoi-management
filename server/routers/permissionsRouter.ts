import { z } from "zod";
// Doc 38 Đợt Q — import the CANONICAL adminProcedure (admin role + 2FA enforced)
// instead of the local no-2FA shim that used to live in this file.
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { eq, and } from "drizzle-orm";
import { getDb as getDbRaw } from "../db";
import { permissions, users, userRoles, type Permission, type InsertPermission } from "../../drizzle/schema";

// Non-null DB accessor: throws if the database is not connected so downstream
// queries can rely on a defined handle (resolves "db is possibly null").
async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return db;
}

// Default role permissions mapping
const DEFAULT_ROLE_PERMISSIONS: Record<string, any[]> = {
  admin: [
    // Admin has full access to everything
    // Dashboard
    { category: 'dashboard', moduleName: 'dashboard_view', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'dashboard', moduleName: 'dashboard_widgets', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'dashboard', moduleName: 'dashboard_corporate', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'dashboard', moduleName: 'dashboard_drilldown', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'dashboard', moduleName: 'dashboard_templates', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    // History
    { category: 'history', moduleName: 'history_view', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'history', moduleName: 'history_detail', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_export', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_delete', canView: true, canCreate: false, canEdit: false, canDelete: true, canExport: false },
    { category: 'history', moduleName: 'history_correct', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_ai_analysis', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: true },
    // Analytics
    { category: 'analytics', moduleName: 'analytics_view', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'analytics', moduleName: 'analytics_advanced', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_spc', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_category', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_product_comparison', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_oee', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_oee_targets', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'analytics', moduleName: 'analytics_machine_health', canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_defect_heatmap', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_defect_prediction', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_root_cause', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'analytics', moduleName: 'analytics_predictive_alerts', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'analytics', moduleName: 'analytics_workstation', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_ai_performance', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    // Reports
    { category: 'reports', moduleName: 'reports_view', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'reports', moduleName: 'reports_create', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'reports', moduleName: 'reports_schedule', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'reports', moduleName: 'reports_export', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'reports', moduleName: 'reports_templates', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    // MQTT
    { category: 'mqtt', moduleName: 'mqtt_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'mqtt', moduleName: 'mqtt_configure', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'mqtt', moduleName: 'mqtt_logs', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'mqtt', moduleName: 'mqtt_alerts', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'mqtt', moduleName: 'mqtt_profiles', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'mqtt', moduleName: 'mqtt_assignments', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'mqtt', moduleName: 'mqtt_monitoring', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'mqtt', moduleName: 'mqtt_bulletin', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'mqtt', moduleName: 'mqtt_replay', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false },
    // Settings
    { category: 'settings', moduleName: 'settings_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_factory', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_products', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_machines', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_alerts', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_measurement_points', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_workstations', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_shifts', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_stages', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_yield_thresholds', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_product_mapping', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_process', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_smtp', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'settings', moduleName: 'settings_notification_sounds', canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_cache', canView: true, canCreate: false, canEdit: true, canDelete: true, canExport: false },
    // ★★★ doc 78 PHA A+C — bit "AI đọc/GHI mã nguồn". Với `admin` hàng này là để BẢNG QUYỀN của
    // giao diện đủ mục; cổng thì không cần nó (`checkPermission` short-circuit `true` cho vai admin
    // khi chưa bật scoped-admin). `canView`=đọc (pha A: read_file/list_files/grep_repo);
    // `canEdit`=GHI (pha C: apply_diff — đọc/ghi cùng một đối tượng tệp repo ⇒ cùng module, khác action).
    { category: 'settings', moduleName: 'ai_repo_read', canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false },
    // ★★★ doc 78 PHA B — bit "AI chạy lệnh". MODULE RIÊNG, không phải một `action` khác của
    // `ai_repo_read`: gộp chung là để một ô tick trên dòng "AI đọc mã nguồn" mở quyền SINH TIẾN
    // TRÌNH trong im lặng (xem khối RBAC ở writeHandlers/repoCommand.ts). Chỉ `canCreate`.
    { category: 'settings', moduleName: 'ai_repo_exec', canView: false, canCreate: true, canEdit: false, canDelete: false, canExport: false },
    // Admin
    { category: 'admin', moduleName: 'admin_users', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'admin', moduleName: 'admin_permissions', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'admin', moduleName: 'admin_roles', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'admin', moduleName: 'admin_system', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'admin', moduleName: 'admin_audit', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'admin', moduleName: 'admin_sessions', canView: true, canCreate: false, canEdit: false, canDelete: true, canExport: false },
    { category: 'admin', moduleName: 'admin_2fa', canView: true, canCreate: false, canEdit: true, canDelete: true, canExport: false },
    { category: 'admin', moduleName: 'admin_backup', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: true },
    { category: 'admin', moduleName: 'admin_import_export', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: true },
    // Production
    { category: 'production', moduleName: 'production_orders', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'production', moduleName: 'production_layout', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'production', moduleName: 'production_line_assignments', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    // doc 40 Lan-P0 — phiên sản xuất (vào ca/tạm dừng/kết thúc/bàn giao). Tách khỏi production_orders.
    { category: 'production', moduleName: 'production_session', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    // Machine Monitoring
    { category: 'machine_monitoring', moduleName: 'machine_status', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'machine_monitoring', moduleName: 'machine_alerts', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'machine_monitoring', moduleName: 'machine_downtime', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    // Machine Control (Sprint F4a — OT HITL write-action)
    // CONVENTION (Phương án A — execute→canCreate; KHÔNG đụng lõi RBAC):
    //   canCreate = execute lệnh rủi ro cao (start/stop/reset/select_recipe/download_job)
    //   canEdit   = đặt tham số (set_machine_param) / ack cảnh báo (acknowledge_machine_alarm)
    //   canView   = xem preview / liệt kê command log & recipe
    { category: 'machine_control', moduleName: 'machine_control', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    // Andon + Interlock (Sprint F5a — ALERT-ONLY; interlock engine has no command path)
    { category: 'andon', moduleName: 'andon', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    { category: 'interlock', moduleName: 'interlock', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    // MES BOM + Feeder + Component genealogy (Sprint G2.4 — master data + material telemetry, NO machine write)
    { category: 'mes_bom', moduleName: 'mes_bom', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    // Energy advanced (Sprint G2.6a — per-recipe/peak/PF/forecast read + energy telemetry, NO machine write)
    { category: 'energy', moduleName: 'energy', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
    // Annotations
    { category: 'annotations', moduleName: 'annotation_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'annotations', moduleName: 'annotation_create', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'annotations', moduleName: 'annotation_templates', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'annotations', moduleName: 'annotation_export', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'annotations', moduleName: 'annotation_ai', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
  ],
  supervisor: [
    // Supervisor can view and manage most things except admin functions
    // Dashboard
    { category: 'dashboard', moduleName: 'dashboard_view', canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: true },
    { category: 'dashboard', moduleName: 'dashboard_widgets', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    { category: 'dashboard', moduleName: 'dashboard_corporate', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'dashboard', moduleName: 'dashboard_drilldown', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    // History
    { category: 'history', moduleName: 'history_view', canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_detail', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_export', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_correct', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // Analytics
    { category: 'analytics', moduleName: 'analytics_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_advanced', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_spc', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_oee', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_machine_health', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_workstation', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_defect_heatmap', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    // ★★ QĐ chủ dự án 2026-08-17 — mở `analytics_category` (VIEW-ONLY) để trợ lý trả lời được
    // `get_model_metrics` (xếp hạng model theo NG). Mở luôn route `/category-analytics`
    // (RouteGuard). Backfill cho user đã tồn tại: drizzle/0322_grant_analytics_category_supervisor_quality.sql
    { category: 'analytics', moduleName: 'analytics_category', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'analytics', moduleName: 'analytics_root_cause', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    // Reports
    { category: 'reports', moduleName: 'reports_view', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    { category: 'reports', moduleName: 'reports_create', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'reports', moduleName: 'reports_schedule', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'reports', moduleName: 'reports_export', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'reports', moduleName: 'reports_templates', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // MQTT
    { category: 'mqtt', moduleName: 'mqtt_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'mqtt', moduleName: 'mqtt_monitoring', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // Settings
    { category: 'settings', moduleName: 'settings_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_alerts', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // B1 go-live 2026-06-27: engineering agentic-write (update_product_quality_target).
    { category: 'settings', moduleName: 'settings_products', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_shifts', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // Production
    { category: 'production', moduleName: 'production_orders', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    { category: 'production', moduleName: 'production_layout', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'production', moduleName: 'production_line_assignments', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // doc 40 Lan-P0 — supervisor quản lý phiên sản xuất của line.
    { category: 'production', moduleName: 'production_session', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // Machine Monitoring
    { category: 'machine_monitoring', moduleName: 'machine_status', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'machine_monitoring', moduleName: 'machine_downtime', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    // Machine Control (Sprint F4a) — supervisor can execute (canCreate) + set param/ack (canEdit), but not delete recipes
    { category: 'machine_control', moduleName: 'machine_control', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // Andon + Interlock (F5a) — supervisor manages Andon + interlock rules (no delete on andon)
    { category: 'andon', moduleName: 'andon', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'interlock', moduleName: 'interlock', canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: false },
    // MES BOM (G2.4) — supervisor (manager) manages BOM/feeder fully (no delete on definitions)
    { category: 'mes_bom', moduleName: 'mes_bom', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    // Energy advanced (G2.6a) — supervisor views analytics, records readings + edits EnPI snapshots (no delete)
    { category: 'energy', moduleName: 'energy', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    // Annotations
    { category: 'annotations', moduleName: 'annotation_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'annotations', moduleName: 'annotation_create', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
  ],
  quality_inspector: [
    // Quality inspector focuses on inspection data and quality control
    // Dashboard
    { category: 'dashboard', moduleName: 'dashboard_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    // History
    { category: 'history', moduleName: 'history_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_detail', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_export', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_correct', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_ai_analysis', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false },
    // Analytics
    { category: 'analytics', moduleName: 'analytics_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_advanced', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_spc', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_defect_heatmap', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    // ★★ QĐ chủ dự án 2026-08-17 — xem chú thích ở khối `supervisor`. VIEW-ONLY.
    { category: 'analytics', moduleName: 'analytics_category', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'analytics', moduleName: 'analytics_root_cause', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    // Reports
    { category: 'reports', moduleName: 'reports_view', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: true },
    { category: 'reports', moduleName: 'reports_create', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false },
    { category: 'reports', moduleName: 'reports_export', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    // Settings
    { category: 'settings', moduleName: 'settings_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_alerts', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // Annotations
    { category: 'annotations', moduleName: 'annotation_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'annotations', moduleName: 'annotation_create', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'annotations', moduleName: 'annotation_templates', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'annotations', moduleName: 'annotation_ai', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false },
    // Andon (F5a) — quality inspector can raise/ack/resolve quality Andons (no interlock rule mgmt)
    { category: 'andon', moduleName: 'andon', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // MES BOM (G2.4) — quality reviews BOM/feeder + records installs (no delete on definitions)
    { category: 'mes_bom', moduleName: 'mes_bom', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    // Energy advanced (G2.6a) — quality views energy analytics (read-only)
    { category: 'energy', moduleName: 'energy', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
  ],
  operator: [
    // Operator can view assigned machines and submit inspection data
    { category: 'dashboard', moduleName: 'dashboard_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_detail', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'machine_monitoring', moduleName: 'machine_status', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'machine_monitoring', moduleName: 'machine_downtime', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false },
    // doc 54 Wave B (Đ3) — read-only visibility of the MQTT/Connectivity hub. View ONLY;
    // every mqtt mutation stays gated (writeProcedure + mqtt permission bit).
    { category: 'mqtt', moduleName: 'mqtt_monitoring', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'production', moduleName: 'production_orders', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // doc 40 Lan-P0 — operator TỰ mở/tạm dừng/kết thúc/bàn giao ca của mình (không cần
    // quyền tạo đơn sản xuất). Mở khóa OperatorSessionControl + ShiftHandoverDialog.
    { category: 'production', moduleName: 'production_session', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // ★★ QĐ chủ dự án 2026-08-17 — mở `analytics_defect_heatmap` (VIEW-ONLY) cho operator/
    // maintenance/engineer, để trợ lý (`analytics_defect_heatmap_summary`) và giao diện
    // (`/defect-heatmap`) đứng sau CÙNG MỘT luật. Đường "hạ bit tool xuống dashboard_view" đã bị
    // BÁC BỎ (đẻ hai cửa vào một lớp dữ liệu; hai tool không cùng tập — xem §10b của
    // services/aiLocalTools/toolPermissionQuantifier.test.ts).
    // Backfill cho user đã tồn tại: drizzle/0323_grant_analytics_defect_heatmap_ops_roles.sql
    { category: 'analytics', moduleName: 'analytics_defect_heatmap', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // Andon (F5a) — operators raise/ack/resolve Andons from the line
    { category: 'andon', moduleName: 'andon', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // Energy advanced (G2.6a) — operators view + manually record energy readings (telemetry, no machine write)
    { category: 'energy', moduleName: 'energy', canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false },
  ],
  maintenance: [
    // Maintenance can view machine status and logs
    { category: 'dashboard', moduleName: 'dashboard_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_detail', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'history', moduleName: 'history_export', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'mqtt', moduleName: 'mqtt_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'mqtt', moduleName: 'mqtt_logs', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'mqtt', moduleName: 'mqtt_monitoring', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_machines', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // B1 go-live 2026-06-27: engineering agentic-write (adjust/configure/create NG threshold + product target).
    { category: 'settings', moduleName: 'settings_alerts', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_products', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'machine_monitoring', moduleName: 'machine_status', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: 'machine_monitoring', moduleName: 'machine_alerts', canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false },
    { category: 'machine_monitoring', moduleName: 'machine_downtime', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
    { category: 'analytics', moduleName: 'analytics_machine_health', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    // ★★ QĐ chủ dự án 2026-08-17 — xem chú thích ở khối `operator`. VIEW-ONLY.
    { category: 'analytics', moduleName: 'analytics_defect_heatmap', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // Machine Control (Sprint F4a) — maintenance can set param/ack (canEdit) and view,
    // but NOT execute high-risk commands (canCreate:false → start/stop/recipe gated to supervisor/admin)
    { category: 'machine_control', moduleName: 'machine_control', canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false },
  ],
  engineer: [
    // Automation-programming engineer (PLC/robot/Zmotion) — machine setup + control,
    // measurement/product/alert authoring (canCreate/canEdit); read-only across quality
    // surfaces. (doc 34 P3 / decision D6)
    // Dashboard
    { category: 'dashboard', moduleName: 'dashboard_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // History
    { category: 'history', moduleName: 'history_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_detail', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // Analytics
    { category: 'analytics', moduleName: 'analytics_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'analytics', moduleName: 'analytics_spc', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'analytics', moduleName: 'analytics_machine_health', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // ★★ QĐ chủ dự án 2026-08-17 — xem chú thích ở khối `operator`. VIEW-ONLY.
    { category: 'analytics', moduleName: 'analytics_defect_heatmap', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // Reports
    { category: 'reports', moduleName: 'reports_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // Settings — engineer authors measurement points, products + alert thresholds
    // doc 54 P0.3 — settings_factory in the DEFAULT matrix too (existing engineers got it
    // via mig 0269; this keeps freshly-seeded engineers consistent for factory-config +
    // hierarchy bulk-import). canDelete stays admin-only.
    { category: 'settings', moduleName: 'settings_factory', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_measurement_points', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_products', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'settings', moduleName: 'settings_alerts', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // ★★★ doc 78 PHA A+C — trợ lý AI ĐỌC (`read_file`/`list_files`/`grep_repo`, canView) VÀ GHI
    // (`apply_diff`, canEdit) mã nguồn nền tảng. "Đọc được" và "ghi được" là HAI action KHÁC nhau
    // trên CÙNG một module (cùng đối tượng: tệp repo) — thu quyền ghi mà giữ quyền đọc chỉ cần bỏ
    // một ô tick. Backfill: mig 0330 (canView) + mig 0332 (canEdit).
    { category: 'settings', moduleName: 'ai_repo_read', canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false },
    // ★★★ doc 78 PHA B (2026-08-18) — trợ lý AI CHẠY LỆNH trong danh sách TRẮNG (`run_command`:
    // npm run check · npm run check:tests · npx vitest run <đường> · git status · git diff).
    // Chỉ `canCreate` ("tạo một lượt chạy"); tool là WRITE nên MỌI lượt vẫn phải qua HITL.
    // Backfill: mig 0331.
    { category: 'settings', moduleName: 'ai_repo_exec', canView: false, canCreate: true, canEdit: false, canDelete: false, canExport: false },
    // Machine Monitoring
    { category: 'machine_monitoring', moduleName: 'machine_status', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'machine_monitoring', moduleName: 'machine_alerts', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    { category: 'machine_monitoring', moduleName: 'machine_downtime', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // doc 54 Wave B (Đ3) — read-only visibility of the MQTT/Connectivity hub. View ONLY;
    // every mqtt mutation stays gated (writeProcedure + mqtt permission bit).
    { category: 'mqtt', moduleName: 'mqtt_monitoring', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // Machine Control (Sprint F4a) — engineer can execute (canCreate) + set param/ack (canEdit)
    { category: 'machine_control', moduleName: 'machine_control', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // Andon (F5a) — engineer raises/ack/resolve
    { category: 'andon', moduleName: 'andon', canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
    // Interlock (F5a) — read-only view
    { category: 'interlock', moduleName: 'interlock', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    // MES BOM (G2.4) — read-only view
    { category: 'mes_bom', moduleName: 'mes_bom', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
  ],
  viewer: [
    // Viewer has read-only access to dashboards and reports
    { category: 'dashboard', moduleName: 'dashboard_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_detail', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'analytics', moduleName: 'analytics_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'reports', moduleName: 'reports_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'machine_monitoring', moduleName: 'machine_status', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
  ],
  user: [
    // Basic user access
    { category: 'dashboard', moduleName: 'dashboard_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_view', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
    { category: 'history', moduleName: 'history_detail', canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
  ]
};

// Doc 38 Đợt Q — the local admin/supervisor/quality procedure shims (which did NOT
// enforce 2FA and thus undercut the canonical guards) have been removed. `adminProcedure`
// now comes from _core/trpc (admin + 2FA). The supervisor/quality shims were dead code
// (every handler used adminProcedure) and were dropped.

// Permission category enum for validation
const permissionCategoryEnum = z.enum([
  'dashboard',
  'history',
  'analytics',
  'reports',
  'mqtt',
  'settings',
  'admin',
  'production',
  'machine_monitoring',
  'annotations',
  'machine_control',
  'andon',
  'interlock',
  'mes_bom',
  'energy'
]);

export const permissionsRouter = router({
  // ============ ROLE MANAGEMENT ============
  
  // List all available role types
  listRoleTypes: protectedProcedure
    .query(() => {
      return [
        {
          value: 'admin',
          label: 'Admin',
          description: 'Full system access - can manage everything',
          icon: 'shield-check',
          color: 'red'
        },
        {
          value: 'supervisor',
          label: 'Supervisor',
          description: 'Workshop supervisor - can view all data and manage operators',
          icon: 'users',
          color: 'blue'
        },
        {
          value: 'quality_inspector',
          label: 'Quality Inspector',
          description: 'Quality control specialist - can view and export data, manage quality alerts',
          icon: 'clipboard-check',
          color: 'green'
        },
        {
          value: 'operator',
          label: 'Operator',
          description: 'Machine operator - can view assigned machines and submit data',
          icon: 'user-cog',
          color: 'purple'
        },
        {
          value: 'maintenance',
          label: 'Maintenance',
          description: 'Maintenance technician - can view machine status and logs',
          icon: 'wrench',
          color: 'orange'
        },
        {
          value: 'engineer',
          label: 'Engineer',
          description: 'Automation-programming engineer (PLC/robot/Zmotion)',
          icon: 'cpu',
          color: 'cyan'
        },
        {
          value: 'viewer',
          label: 'Viewer',
          description: 'Read-only access - can only view dashboards and reports',
          icon: 'eye',
          color: 'gray'
        },
        {
          value: 'user',
          label: 'User',
          description: 'Basic user access',
          icon: 'user',
          color: 'slate'
        }
      ];
    }),

  // Update user role  
  updateUserRole: adminProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(['admin', 'supervisor', 'quality_inspector', 'operator', 'maintenance', 'engineer', 'viewer', 'user'])
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      
      const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      
      if (!targetUser) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'User not found');
      }
      
      await db
        .update(users)
        .set({
          role: input.role,
          updatedAt: new Date()
        })
        .where(eq(users.id, input.userId));
      
      return { success: true, userId: input.userId, newRole: input.role };
    }),

  // Get role statistics
  getRoleStatistics: adminProcedure
    .query(async () => {
      const db = await getDb();
      const allUsers = await db.select({ role: users.role }).from(users);
      
      const stats = allUsers.reduce((acc: Record<string, number>, user: any) => {
        acc[user.role] = (acc[user.role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      return stats;
    }),

  // Get default permissions for a role
  getDefaultPermissionsForRole: adminProcedure
    .input(z.object({
      role: z.enum(['admin', 'supervisor', 'quality_inspector', 'operator', 'maintenance', 'engineer', 'viewer', 'user'])
    }))
    .query(({ input }) => {
      return DEFAULT_ROLE_PERMISSIONS[input.role] || [];
    }),

  // Apply default permissions to user based on role
  applyRolePermissions: adminProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(['admin', 'supervisor', 'quality_inspector', 'operator', 'maintenance', 'engineer', 'viewer', 'user'])
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      
      // Get default permissions for role
      const defaultPerms = DEFAULT_ROLE_PERMISSIONS[input.role] || [];
      
      // Delete existing permissions
      await db
        .delete(permissions)
        .where(eq(permissions.userId, input.userId));
      
      // Insert new default permissions
      if (defaultPerms.length > 0) {
        await db
          .insert(permissions)
          .values(
            defaultPerms.map((perm: any) => ({
              userId: input.userId,
              category: perm.category,
              moduleName: perm.moduleName,
              canView: perm.canView,
              canCreate: perm.canCreate,
              canEdit: perm.canEdit,
              canDelete: perm.canDelete,
              canExport: perm.canExport,
              grantedBy: ctx.user.id,
              grantedAt: new Date(),
            }))
          );
      }
      
      // Update user role
      await db
        .update(users)
        .set({
          role: input.role,
          updatedAt: new Date()
        })
        .where(eq(users.id, input.userId));
      
      return { success: true, permissionsApplied: defaultPerms.length };
    }),

  // ============ EXISTING PERMISSIONS CRUD ============
  
  // Get all users with their permissions
  listUsersWithPermissions: adminProcedure
    .query(async () => {
      const db = await getDb();
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          role: users.role,
          isActive: users.isActive,
        })
        .from(users)
        .orderBy(users.username);
      
      const allPermissions = await db
        .select()
        .from(permissions)
        .orderBy(permissions.userId, permissions.category, permissions.moduleName);
      
      // Group permissions by userId
      const permissionsByUser = allPermissions.reduce((acc: Record<number, Permission[]>, perm: Permission) => {
        if (!acc[perm.userId]) {
          acc[perm.userId] = [];
        }
        acc[perm.userId].push(perm);
        return acc;
      }, {} as Record<number, Permission[]>);
      
      return allUsers.map((user: any) => ({
        ...user,
        permissions: permissionsByUser[user.id] || []
      }));
    }),

  // Get permissions for a specific user
  getUserPermissions: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      // Users can view their own permissions, admins can view any user's permissions
      if (ctx.user.id !== input.userId && ctx.user.role !== 'admin') {
        throw appError('FORBIDDEN', 'PERMISSION_DENIED', { action: 'viewOthersPermissions' }, 'You can only view your own permissions');
      }
      
      const userPermissions = await db
        .select()
        .from(permissions)
        .where(eq(permissions.userId, input.userId))
        .orderBy(permissions.category, permissions.moduleName);
      
      return userPermissions;
    }),

  // Get current user's permissions (for UI access control)
  getMyPermissions: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      const userPermissions = await db
        .select()
        .from(permissions)
        .where(eq(permissions.userId, ctx.user.id))
        .orderBy(permissions.category, permissions.moduleName);
      
      return userPermissions;
    }),

  // Create or update a permission for a user
  upsertPermission: adminProcedure
    .input(z.object({
      userId: z.number(),
      category: permissionCategoryEnum,
      moduleName: z.string().min(1).max(100),
      canView: z.boolean().default(false),
      canCreate: z.boolean().default(false),
      canEdit: z.boolean().default(false),
      canDelete: z.boolean().default(false),
      canExport: z.boolean().default(false),
      customPermissions: z.record(z.string(), z.any()).optional(),
      expiresAt: z.date().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Check if user exists
      const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      
      if (!targetUser) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'User not found');
      }
      
      // Check if permission already exists
      const [existing] = await db.select().from(permissions).where(and(
        eq(permissions.userId, input.userId),
        eq(permissions.moduleName, input.moduleName)
      )).limit(1);
      
      if (existing) {
        // Update existing permission
        await db
          .update(permissions)
          .set({
            category: input.category,
            canView: input.canView,
            canCreate: input.canCreate,
            canEdit: input.canEdit,
            canDelete: input.canDelete,
            canExport: input.canExport,
            customPermissions: input.customPermissions,
            grantedBy: ctx.user.id,
            grantedAt: new Date(),
            expiresAt: input.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(permissions.id, existing.id));
        
        return { success: true, action: 'updated', permissionId: existing.id };
      } else {
        // Create new permission
        const [newPermission] = await db
          .insert(permissions)
          .values({
            userId: input.userId,
            category: input.category,
            moduleName: input.moduleName,
            canView: input.canView,
            canCreate: input.canCreate,
            canEdit: input.canEdit,
            canDelete: input.canDelete,
            canExport: input.canExport,
            customPermissions: input.customPermissions,
            grantedBy: ctx.user.id,
            grantedAt: new Date(),
            expiresAt: input.expiresAt,
          })
          .returning();
        
        return { success: true, action: 'created', permissionId: newPermission.id };
      }
    }),

  // Batch update permissions for a user
  batchUpdateUserPermissions: adminProcedure
    .input(z.object({
      userId: z.number(),
      permissions: z.array(z.object({
        category: permissionCategoryEnum,
        moduleName: z.string().min(1).max(100),
        canView: z.boolean().default(false),
        canCreate: z.boolean().default(false),
        canEdit: z.boolean().default(false),
        canDelete: z.boolean().default(false),
        canExport: z.boolean().default(false),
        customPermissions: z.record(z.string(), z.any()).optional(),
      }))
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Check if user exists
      const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      
      if (!targetUser) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'User not found');
      }
      
      // Delete all existing permissions for this user
      await db
        .delete(permissions)
        .where(eq(permissions.userId, input.userId));
      
      // Insert new permissions
      if (input.permissions.length > 0) {
        await db
          .insert(permissions)
          .values(
            input.permissions.map(perm => ({
              userId: input.userId,
              category: perm.category,
              moduleName: perm.moduleName,
              canView: perm.canView,
              canCreate: perm.canCreate,
              canEdit: perm.canEdit,
              canDelete: perm.canDelete,
              canExport: perm.canExport,
              customPermissions: perm.customPermissions,
              grantedBy: ctx.user.id,
              grantedAt: new Date(),
            }))
          );
      }
      
      return { success: true, count: input.permissions.length };
    }),

  // Delete a permission
  deletePermission: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [permission] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.id, input.id)).limit(1);
      
      if (!permission) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'permission' }, 'Permission not found');
      }
      
      await db
        .delete(permissions)
        .where(eq(permissions.id, input.id));
      
      return { success: true };
    }),

  // Delete all permissions for a user
  deleteUserPermissions: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db
        .delete(permissions)
        .where(eq(permissions.userId, input.userId));
      
      return { success: true };
    }),

  // Get available modules for permission assignment
  getAvailableModules: adminProcedure
    .query(() => {
      return [
        // ======================== DASHBOARD ========================
        { category: 'dashboard', moduleName: 'dashboard_view', displayName: 'Xem Dashboard', description: 'Truy cập trang dashboard chính, xem tổng quan sản xuất' },
        { category: 'dashboard', moduleName: 'dashboard_widgets', displayName: 'Quản lý Widget', description: 'Thêm/sửa/xóa widget trên dashboard, tùy chỉnh bố cục' },
        { category: 'dashboard', moduleName: 'dashboard_corporate', displayName: 'Dashboard Tập đoàn', description: 'Xem dashboard tổng hợp toàn tập đoàn, so sánh nhà máy' },
        { category: 'dashboard', moduleName: 'dashboard_drilldown', displayName: 'Drill-Down Chi tiết', description: 'Xem chi tiết từ tập đoàn → nhà máy → dây chuyền → máy' },
        { category: 'dashboard', moduleName: 'dashboard_templates', displayName: 'Mẫu Dashboard', description: 'Tạo và quản lý mẫu dashboard, marketplace template' },

        // ======================== HISTORY ========================
        { category: 'history', moduleName: 'history_view', displayName: 'Xem Lịch sử', description: 'Truy cập trang lịch sử kiểm tra, tìm kiếm, lọc dữ liệu' },
        { category: 'history', moduleName: 'history_detail', displayName: 'Xem Chi tiết Inspection', description: 'Xem chi tiết từng inspection, xem ảnh, kết quả đo' },
        { category: 'history', moduleName: 'history_export', displayName: 'Xuất Lịch sử', description: 'Xuất dữ liệu lịch sử ra CSV/Excel/PDF' },
        { category: 'history', moduleName: 'history_delete', displayName: 'Xóa Lịch sử', description: 'Xóa bản ghi inspection từ hệ thống' },
        { category: 'history', moduleName: 'history_correct', displayName: 'Sửa kết quả Inspection', description: 'Chỉnh sửa, annotation kết quả kiểm tra, xác nhận NTF' },
        { category: 'history', moduleName: 'history_ai_analysis', displayName: 'Phân tích AI', description: 'Sử dụng AI để phân tích kết quả kiểm tra' },

        // ======================== ANALYTICS ========================
        { category: 'analytics', moduleName: 'analytics_view', displayName: 'Xem Analytics', description: 'Truy cập trang phân tích cơ bản' },
        { category: 'analytics', moduleName: 'analytics_advanced', displayName: 'Phân tích Nâng cao', description: 'Truy cập SPC, phân tích xu hướng, v.v.' },
        { category: 'analytics', moduleName: 'analytics_spc', displayName: 'Phân tích SPC', description: 'Biểu đồ kiểm soát, phát hiện bất thường, phân tích năng lực' },
        { category: 'analytics', moduleName: 'analytics_category', displayName: 'Analytics theo Loại SP', description: 'Phân tích theo danh mục sản phẩm' },
        { category: 'analytics', moduleName: 'analytics_product_comparison', displayName: 'So sánh Sản phẩm', description: 'So sánh chỉ số giữa các sản phẩm/model' },
        { category: 'analytics', moduleName: 'analytics_oee', displayName: 'Dashboard OEE', description: 'Xem hiệu suất thiết bị tổng thể (OEE)' },
        { category: 'analytics', moduleName: 'analytics_oee_targets', displayName: 'Cấu hình Mục tiêu OEE', description: 'Thiết lập và quản lý mục tiêu OEE' },
        { category: 'analytics', moduleName: 'analytics_machine_health', displayName: 'Sức khỏe Máy', description: 'Giám sát sức khỏe máy, downtime, bảo trì' },
        { category: 'analytics', moduleName: 'analytics_defect_heatmap', displayName: 'Heatmap Lỗi', description: 'Xem bản đồ nhiệt phân bố lỗi trên sản phẩm' },
        { category: 'analytics', moduleName: 'analytics_defect_prediction', displayName: 'Dự đoán Lỗi', description: 'Xem dự đoán xu hướng lỗi bằng AI' },
        { category: 'analytics', moduleName: 'analytics_root_cause', displayName: 'Phân tích Nguyên nhân gốc', description: 'Phân tích và quản lý nguyên nhân gốc của lỗi' },
        { category: 'analytics', moduleName: 'analytics_predictive_alerts', displayName: 'Cảnh báo Dự đoán', description: 'Quản lý cảnh báo dự đoán thông minh' },
        { category: 'analytics', moduleName: 'analytics_workstation', displayName: 'Analytics Trạm Làm việc', description: 'Phân tích theo trạm làm việc (workstation)' },
        { category: 'analytics', moduleName: 'analytics_ai_performance', displayName: 'Hiệu suất AI', description: 'Dashboard đánh giá hiệu suất mô hình AI' },

        // ======================== REPORTS ========================
        { category: 'reports', moduleName: 'reports_view', displayName: 'Xem Báo cáo', description: 'Truy cập trang báo cáo, xem báo cáo có sẵn' },
        { category: 'reports', moduleName: 'reports_create', displayName: 'Tạo Báo cáo', description: 'Tạo mới báo cáo từ dữ liệu hệ thống' },
        { category: 'reports', moduleName: 'reports_schedule', displayName: 'Lịch trình Báo cáo', description: 'Đặt lịch gửi báo cáo tự động qua email' },
        { category: 'reports', moduleName: 'reports_export', displayName: 'Xuất Báo cáo', description: 'Xuất báo cáo ra PDF/Excel/CSV' },
        { category: 'reports', moduleName: 'reports_templates', displayName: 'Mẫu Báo cáo', description: 'Quản lý mẫu báo cáo tùy chỉnh' },

        // ======================== MQTT ========================
        { category: 'mqtt', moduleName: 'mqtt_view', displayName: 'Xem MQTT Status', description: 'Giám sát trạng thái kết nối MQTT, thống kê' },
        { category: 'mqtt', moduleName: 'mqtt_configure', displayName: 'Cấu hình MQTT', description: 'Thêm/sửa/xóa MQTT client, cấu hình topic' },
        { category: 'mqtt', moduleName: 'mqtt_logs', displayName: 'Xem Log MQTT', description: 'Truy cập nhật ký tin nhắn MQTT, lịch sử kết nối' },
        { category: 'mqtt', moduleName: 'mqtt_alerts', displayName: 'Cảnh báo MQTT', description: 'Quản lý quy tắc cảnh báo MQTT, xem lịch sử cảnh báo' },
        { category: 'mqtt', moduleName: 'mqtt_profiles', displayName: 'MQTT Profile', description: 'Quản lý profile kết nối MQTT (tạo/sửa/xóa/nhân bản)' },
        { category: 'mqtt', moduleName: 'mqtt_assignments', displayName: 'MQTT Gán Profile', description: 'Gán profile MQTT cho máy/dây chuyền' },
        { category: 'mqtt', moduleName: 'mqtt_monitoring', displayName: 'Giám sát Kết nối', description: 'Giám sát chi tiết trạng thái kết nối, health check' },
        { category: 'mqtt', moduleName: 'mqtt_bulletin', displayName: 'MQTT Bulletin', description: 'Quản lý bulletin phát qua MQTT, lên lịch phát' },
        { category: 'mqtt', moduleName: 'mqtt_replay', displayName: 'MQTT Replay', description: 'Phát lại tin nhắn MQTT để kiểm tra' },

        // ======================== SETTINGS ========================
        { category: 'settings', moduleName: 'settings_view', displayName: 'Xem Cài đặt', description: 'Truy cập trang cài đặt hệ thống' },
        { category: 'settings', moduleName: 'settings_factory', displayName: 'QL Nhà máy', description: 'Quản lý nhà máy, xưởng, dây chuyền, trạm' },
        { category: 'settings', moduleName: 'settings_products', displayName: 'QL Sản phẩm', description: 'Quản lý sản phẩm, model, danh mục sản phẩm' },
        { category: 'settings', moduleName: 'settings_machines', displayName: 'QL Thiết bị', description: 'Quản lý máy AOI, đồng bộ máy, cấu hình kết nối' },
        { category: 'settings', moduleName: 'settings_alerts', displayName: 'QL Cảnh báo', description: 'Cấu hình quy tắc cảnh báo, ngưỡng thông báo' },
        { category: 'settings', moduleName: 'settings_measurement_points', displayName: 'QL Điểm đo', description: 'Quản lý điểm đo trên sản phẩm, upload ảnh crop' },
        { category: 'settings', moduleName: 'settings_workstations', displayName: 'QL Trạm Làm việc', description: 'Quản lý trạm làm việc (workstation)' },
        { category: 'settings', moduleName: 'settings_shifts', displayName: 'QL Ca làm việc', description: 'Cấu hình ca làm việc, lịch ca' },
        { category: 'settings', moduleName: 'settings_stages', displayName: 'QL Công đoạn', description: 'Quản lý công đoạn trên dây chuyền' },
        { category: 'settings', moduleName: 'settings_yield_thresholds', displayName: 'Ngưỡng Yield', description: 'Cấu hình ngưỡng yield cảnh báo' },
        { category: 'settings', moduleName: 'settings_product_mapping', displayName: 'Gán SP-Máy', description: 'Gán sản phẩm cho máy, quản lý bản đồ SP-Máy' },
        { category: 'settings', moduleName: 'settings_process', displayName: 'QL Quy trình', description: 'Quản lý quy trình sản xuất' },
        { category: 'settings', moduleName: 'settings_smtp', displayName: 'Cấu hình Email', description: 'Cấu hình SMTP, mẫu email thông báo' },
        { category: 'settings', moduleName: 'settings_notification_sounds', displayName: 'Âm thanh Thông báo', description: 'Tùy chỉnh âm thanh cảnh báo/thông báo' },
        { category: 'settings', moduleName: 'settings_cache', displayName: 'Quản lý Cache', description: 'Xem thống kê cache, xóa cache' },
        // doc 78 PHA A — bit này phải HIỆN trong bảng phân quyền, nếu không quản trị viên không có
        // đường cấp/thu hồi nó cho một người cụ thể (và bit sẽ chỉ đổi được bằng migration).
        { category: 'settings', moduleName: 'ai_repo_read', displayName: 'AI đọc/ghi mã nguồn', description: 'Cho trợ lý AI ĐỌC mã nguồn nền tảng (canView: read_file/list_files/grep_repo) và GHI/SỬA tệp (canEdit: apply_diff) — trong hộp cát repo, cấm .env và khoá bí mật. GHI luôn qua XÁC NHẬN của người dùng (HITL), TỪ CHỐI tệp có thay đổi chưa commit, và so băm chống ghi nhầm phiên bản.' },
        // doc 78 PHA B — bit RIÊNG cho mặt CHẠY LỆNH. Tách khỏi `ai_repo_read` theo đúng tiền lệ
        // `vram_control` (mặt lệnh tách khỏi mặt đọc): cấp quyền ĐỌC mã nguồn không được kéo theo
        // quyền SINH TIẾN TRÌNH trên máy chủ. Đây là DÒNG CATALOG — nó KHÔNG cấp quyền cho ai.
        { category: 'settings', moduleName: 'ai_repo_exec', displayName: 'AI chạy lệnh (danh sách trắng)', displayNameEn: 'AI run command (allowlist)', displayNameZh: 'AI 运行命令（白名单）', description: 'Cho trợ lý AI ĐỀ XUẤT chạy một lệnh trong danh sách TRẮNG tại thư mục repo (canCreate): npm run check · npm run check:tests · npx vitest run <đường> · git status · git diff. Mọi lượt vẫn phải qua XÁC NHẬN của người dùng (HITL); git checkout/git reset/rm KHÔNG BAO GIỜ được phép. KHÔNG bao gồm quyền ĐỌC mã nguồn — mặt đọc đứng trên ai_repo_read/canView.' },

        // ======================== ADMIN ========================
        { category: 'admin', moduleName: 'admin_users', displayName: 'QL Người dùng', description: 'Tạo/sửa/xóa tài khoản người dùng' },
        { category: 'admin', moduleName: 'admin_permissions', displayName: 'QL Phân quyền', description: 'Quản lý quyền truy cập cho người dùng' },
        { category: 'admin', moduleName: 'admin_roles', displayName: 'QL Vai trò', description: 'Quản lý vai trò, gán vai trò cho người dùng' },
        { category: 'admin', moduleName: 'admin_system', displayName: 'Cấu hình Hệ thống', description: 'Cấu hình hệ thống nâng cao' },
        { category: 'admin', moduleName: 'admin_audit', displayName: 'Nhật ký Audit', description: 'Xem nhật ký hoạt động hệ thống' },
        { category: 'admin', moduleName: 'admin_sessions', displayName: 'QL Phiên đăng nhập', description: 'Xem/thu hồi phiên đăng nhập người dùng' },
        { category: 'admin', moduleName: 'admin_2fa', displayName: 'QL Xác thực 2 bước', description: 'Quản lý xác thực hai yếu tố (2FA)' },
        { category: 'admin', moduleName: 'admin_backup', displayName: 'Sao lưu & Phục hồi', description: 'Sao lưu dữ liệu, khôi phục cấu hình' },
        { category: 'admin', moduleName: 'admin_import_export', displayName: 'Nhập/Xuất dữ liệu', description: 'Nhập/xuất hàng loạt nhà máy, máy, sản phẩm' },

        // ======================== PRODUCTION ========================
        { category: 'production', moduleName: 'production_orders', displayName: 'QL Đơn sản xuất', description: 'Tạo/sửa/xóa đơn hàng sản xuất, lên lịch' },
        { category: 'production', moduleName: 'production_layout', displayName: 'Bố trí Xưởng', description: 'Quản lý layout xưởng sản xuất, vị trí máy' },
        { category: 'production', moduleName: 'production_line_assignments', displayName: 'Gán SP-Dây chuyền', description: 'Gán sản phẩm cho dây chuyền sản xuất' },
        { category: 'production', moduleName: 'production_session', displayName: 'Phiên sản xuất (Ca)', description: 'Vào ca/tạm dừng/kết thúc/bàn giao ca của operator. Tách khỏi QL Đơn sản xuất — operator mở ca của mình không cần quyền tạo đơn.' },

        // ======================== MACHINE MONITORING ========================
        { category: 'machine_monitoring', moduleName: 'machine_status', displayName: 'Trạng thái Máy', description: 'Giám sát trạng thái máy real-time, uptime' },
        { category: 'machine_monitoring', moduleName: 'machine_alerts', displayName: 'Cảnh báo Máy', description: 'Cấu hình và xem cảnh báo trạng thái máy' },
        { category: 'machine_monitoring', moduleName: 'machine_downtime', displayName: 'Quản lý Downtime', description: 'Ghi nhận và phân tích thời gian ngừng máy' },

        // ======================== MACHINE CONTROL (Sprint F4a — OT HITL) ========================
        { category: 'machine_control', moduleName: 'machine_control', displayName: 'Điều khiển Máy (OT)', description: 'Gửi lệnh điều khiển máy qua HITL: start/stop/recipe (canCreate), đặt tham số/ack (canEdit), xem preview/log (canView). MỌI lệnh phải qua xác nhận của người dùng + audit.' },
        // ★★★ Pha 5 Task 3b — BIT RIÊNG cho mặt LỆNH của bộ điều phối VRAM. Tách khỏi `machine_control`
        // vì `machine_control/canDelete` là sàn dùng chung của 10 thủ tục ở 8 router (8/10 KHÔNG có 2FA,
        // gồm `programming.deleteProject` xoá CASCADE cây mã nguồn) — cấp nó để mở 2 nút VRAM sẽ mở
        // luôn 9 thủ tục khác. `category` dùng lại `machine_control` (chỉ để gom nhóm trong UI; cưỡng
        // chế đọc `moduleName`). Đây là DÒNG CATALOG — nó KHÔNG cấp quyền cho ai.
        { category: 'machine_control', moduleName: 'vram_control', displayName: 'Điều phối VRAM (thu hồi)', displayNameEn: 'VRAM Broker (reclaim)', displayNameZh: '显存调度（回收）', description: 'Ra lệnh cho bộ điều phối VRAM: thu hồi VRAM của một hộ + dọn giấy phép ma (canDelete — PHÁ HUỶ, kèm role-floor + 2FA + OTP tươi), thử lại một lượt nạp đã hoãn (canCreate). KHÔNG bao gồm quyền XEM trạng thái VRAM — mặt đọc đứng trên machine_control/canView.' },

        // ======================== ANDON + INTERLOCK (Sprint F5a — ALERT-ONLY) ========================
        { category: 'andon', moduleName: 'andon', displayName: 'Andon (Cảnh báo)', displayNameEn: 'Andon', displayNameZh: 'Andon 安灯', description: 'Tín hiệu Andon: raise (canCreate), ack/resolve (canEdit), xem danh sách/metrics (canView). Andon CHỈ là tín hiệu — KHÔNG ghi lệnh máy.' },
        { category: 'interlock', moduleName: 'interlock', displayName: 'Interlock (Khóa liên động)', displayNameEn: 'Interlock', displayNameZh: '联锁规则', description: 'Quy tắc interlock: tạo (canCreate), sửa/bật-tắt (canEdit), xóa (canDelete), xem (canView). Duyệt rule là admin-only. F5a ALERT-ONLY — engine KHÔNG ghi lệnh máy.' },

        // ======================== MES BOM (Sprint G2.4 — BOM + Feeder + component genealogy) ========================
        { category: 'mes_bom', moduleName: 'mes_bom', displayName: 'BOM & Feeder (MES)', displayNameEn: 'BOM & Feeder (MES)', displayNameZh: 'BOM 与上料 (MES)', description: 'Quản lý BOM + dòng linh kiện, gán/nạp feeder (canCreate/canEdit), lưu trữ/xóa (canDelete), ghi nhận lắp linh kiện + truy vết 2 chiều (canView). Chỉ dữ liệu + telemetry vật tư — KHÔNG ghi lệnh máy.' },

        // ======================== ENERGY (Sprint G2.6a — energy nâng cao) ========================
        { category: 'energy', moduleName: 'energy', displayName: 'Năng lượng nâng cao', displayNameEn: 'Advanced Energy', displayNameZh: '高级能源', description: 'Phân tích năng lượng theo recipe, đỉnh phụ tải (peak demand), hệ số công suất (PF), dự báo + tư vấn demand-response (canView/canExport); ghi số đo năng lượng (canCreate — telemetry); chốt EnPI snapshot (canEdit). Demand-response CHỈ trả text + i18n key — KHÔNG ghi lệnh máy.' },

        // ======================== ANNOTATIONS ========================
        { category: 'annotations', moduleName: 'annotation_view', displayName: 'Xem Annotation', description: 'Xem annotation trên hình ảnh kiểm tra' },
        { category: 'annotations', moduleName: 'annotation_create', displayName: 'Tạo Annotation', description: 'Tạo và chỉnh sửa annotation trên hình ảnh' },
        { category: 'annotations', moduleName: 'annotation_templates', displayName: 'Mẫu Annotation', description: 'Quản lý mẫu annotation tái sử dụng' },
        { category: 'annotations', moduleName: 'annotation_export', displayName: 'Xuất/Nhập Annotation', description: 'Xuất và nhập dữ liệu annotation' },
        { category: 'annotations', moduleName: 'annotation_ai', displayName: 'AI Annotation', description: 'Sử dụng AI hỗ trợ annotation, feedback training' },
      ];
    }),

  // User Roles Management
  listRoles: adminProcedure
    .query(async () => {
      const db = await getDb();
      return await db
        .select()
        .from(userRoles)
        .orderBy(userRoles.name);
    }),

  createRole: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      permissions: z.array(z.record(z.string(), z.any())),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Check if name already exists
      const [existing] = await db.select({ id: userRoles.id }).from(userRoles).where(eq(userRoles.name, input.name)).limit(1);
      
      if (existing) {
        throw appError('CONFLICT', 'ENTITY_DUPLICATE', { entity: 'role' }, 'Role name already exists');
      }
      
      const [newRole] = await db
        .insert(userRoles)
        .values({
          name: input.name,
          description: input.description,
          permissions: input.permissions,
          createdBy: ctx.user.id,
        })
        .returning();
      
      return newRole;
    }),

  updateRole: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      permissions: z.array(z.record(z.string(), z.any())).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [existing] = await db.select().from(userRoles).where(eq(userRoles.id, input.id)).limit(1);
      
      if (!existing) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'role' }, 'Role not found');
      }
      
      if (existing.isSystem) {
        throw appError('FORBIDDEN', 'OPERATION_FAILED', { operation: 'updateRole' }, 'Cannot modify system roles');
      }
      
      await db
        .update(userRoles)
        .set({
          name: input.name,
          description: input.description,
          permissions: input.permissions,
          updatedAt: new Date(),
        })
        .where(eq(userRoles.id, input.id));
      
      return { success: true };
    }),

  deleteRole: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [existing] = await db.select().from(userRoles).where(eq(userRoles.id, input.id)).limit(1);
      
      if (!existing) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'role' }, 'Role not found');
      }
      
      if (existing.isSystem) {
        throw appError('FORBIDDEN', 'OPERATION_FAILED', { operation: 'deleteRole' }, 'Cannot delete system roles');
      }
      
      await db
        .delete(userRoles)
        .where(eq(userRoles.id, input.id));
      
      return { success: true };
    }),

  // ============================================
  // Custom Role Builder - Feature 3
  // ============================================

  /**
   * Duplicate an existing role as a new custom role.
   * Copies all permission templates from the source role.
   */
  duplicateRole: adminProcedure
    .input(z.object({
      sourceRoleId: z.number().optional(),
      sourceBuiltInRole: z.string().optional(),
      newName: z.string().min(1).max(100),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      // Check name uniqueness
      const [existing] = await db
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(eq(userRoles.name, input.newName))
        .limit(1);
      if (existing) {
        throw appError('CONFLICT', 'ENTITY_DUPLICATE', { entity: 'role' }, 'Tên role đã tồn tại');
      }

      let sourcePermissions: any[];

      if (input.sourceRoleId) {
        // Duplicate from an existing custom role
        const [sourceRole] = await db
          .select()
          .from(userRoles)
          .where(eq(userRoles.id, input.sourceRoleId))
          .limit(1);
        if (!sourceRole) {
          throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'role' }, 'Source role not found');
        }
        sourcePermissions = (sourceRole.permissions as any[]) || [];
      } else if (input.sourceBuiltInRole && DEFAULT_ROLE_PERMISSIONS[input.sourceBuiltInRole]) {
        // Duplicate from a built-in role template
        sourcePermissions = DEFAULT_ROLE_PERMISSIONS[input.sourceBuiltInRole];
      } else {
        // Empty role
        sourcePermissions = [];
      }

      const [newRole] = await db
        .insert(userRoles)
        .values({
          name: input.newName,
          description: input.description || `Nhân bản từ ${input.sourceBuiltInRole || 'custom role'}`,
          permissions: sourcePermissions,
          isSystem: false,
          createdBy: ctx.user.id,
        })
        .returning();

      return newRole;
    }),

  /**
   * Apply a custom role's permission template to a user.
   * Creates/updates individual permission rows for the user
   * based on the role's JSON template.
   */
  applyRoleToUser: adminProcedure
    .input(z.object({
      roleId: z.number(),
      userId: z.number(),
      overwrite: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();

      // Get the role
      const [role] = await db
        .select()
        .from(userRoles)
        .where(eq(userRoles.id, input.roleId))
        .limit(1);
      if (!role) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'role' }, 'Role not found');
      }

      // Validate user exists
      const [targetUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!targetUser) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'User not found');
      }

      const permTemplates = (role.permissions as any[]) || [];
      let applied = 0;
      let skipped = 0;

      for (const tmpl of permTemplates) {
        if (!tmpl.moduleName) continue;

        if (input.overwrite) {
          // Upsert: delete existing then insert
          await db
            .delete(permissions)
            .where(and(
              eq(permissions.userId, input.userId),
              eq(permissions.moduleName, tmpl.moduleName),
            ));

          await db.insert(permissions).values({
            userId: input.userId,
            moduleName: tmpl.moduleName as any,
            canView: tmpl.canView ?? false,
            canCreate: tmpl.canCreate ?? false,
            canEdit: tmpl.canEdit ?? false,
            canDelete: tmpl.canDelete ?? false,
            canExport: tmpl.canExport ?? false,
            grantedBy: ctx.user.id,
          } as any);
          applied++;
        } else {
          // Only insert if no existing permission for this module
          const [existingPerm] = await db
            .select({ id: permissions.id })
            .from(permissions)
            .where(and(
              eq(permissions.userId, input.userId),
              eq(permissions.moduleName, tmpl.moduleName),
            ))
            .limit(1);

          if (!existingPerm) {
            await db.insert(permissions).values({
              userId: input.userId,
              moduleName: tmpl.moduleName as any,
              canView: tmpl.canView ?? false,
              canCreate: tmpl.canCreate ?? false,
              canEdit: tmpl.canEdit ?? false,
              canDelete: tmpl.canDelete ?? false,
              canExport: tmpl.canExport ?? false,
              grantedBy: ctx.user.id,
            } as any);
            applied++;
          } else {
            skipped++;
          }
        }
      }

      return { success: true, applied, skipped, totalTemplates: permTemplates.length };
    }),

  /**
   * Apply a built-in role template to a user.
   * Convenience endpoint that doesn't require a custom role to be created first.
   */
  applyBuiltInRoleToUser: adminProcedure
    .input(z.object({
      builtInRole: z.string(),
      userId: z.number(),
      overwrite: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const permTemplates = DEFAULT_ROLE_PERMISSIONS[input.builtInRole];

      if (!permTemplates) {
        // Task 5 (doc 71) — reason khôi phục danh sách role hợp lệ (validRoles) đã mất
        // khi câu chuẩn INVALID_VALUE chỉ nội suy {{field}} ("vai trò dựng sẵn", không
        // liệt kê role nào mới hợp lệ).
        throw appError(
          'BAD_REQUEST',
          'INVALID_VALUE',
          { field: 'builtInRole', reason: 'unknownBuiltInRole', validRoles: Object.keys(DEFAULT_ROLE_PERMISSIONS).join(', ') },
          `Unknown built-in role: ${input.builtInRole}. Available: ${Object.keys(DEFAULT_ROLE_PERMISSIONS).join(', ')}`,
        );
      }

      // Validate user exists
      const [targetUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!targetUser) {
        throw appError('NOT_FOUND', 'ENTITY_NOT_FOUND', { entity: 'user' }, 'User not found');
      }

      let applied = 0;

      for (const tmpl of permTemplates) {
        if (!tmpl.moduleName) continue;

        if (input.overwrite) {
          await db
            .delete(permissions)
            .where(and(
              eq(permissions.userId, input.userId),
              eq(permissions.moduleName, tmpl.moduleName),
            ));
        }

        await db.insert(permissions).values({
          userId: input.userId,
          moduleName: tmpl.moduleName as any,
          canView: tmpl.canView ?? false,
          canCreate: tmpl.canCreate ?? false,
          canEdit: tmpl.canEdit ?? false,
          canDelete: tmpl.canDelete ?? false,
          canExport: tmpl.canExport ?? false,
          grantedBy: ctx.user.id,
        } as any);
        applied++;
      }

      return { success: true, applied, role: input.builtInRole };
    }),

  /**
   * Get the list of built-in role names available for template duplication.
   */
  getBuiltInRoles: adminProcedure
    .query(() => {
      return Object.keys(DEFAULT_ROLE_PERMISSIONS).map(roleName => ({
        name: roleName,
        permissionCount: DEFAULT_ROLE_PERMISSIONS[roleName].length,
        categories: [...new Set(DEFAULT_ROLE_PERMISSIONS[roleName].map((p: any) => p.category))],
      }));
    }),
});

