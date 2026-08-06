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
 *   1. Liệt kê `PERMISSION_MODULES` — mọi `moduleName` THẬT đã seed.
 *      ⚠⚠ **M-1 (review TOÀN NHÁNH 2026-08-06) — ĐÍNH CHÍNH.** Bản trước viết danh sách này được
 *      canh bởi *"test CI 'mọi requiredPermission phải tồn tại'"*. **Test ấy CHƯA BAO GIỜ tồn
 *      tại.** `git grep PERMISSION_MODULES` / `isValidPermissionModule` ⇒ **0 người dùng** ngoài
 *      chính file này ⇒ `isValidPermissionModule` hôm nay là **MÃ CHẾT**, và thêm một tên vào
 *      danh sách chỉ để `satisfies` biên dịch là **trang trí**.
 *      ⚠ Và lượt vá này **cố ý KHÔNG dựng cái lưới ấy**, vì đã đo trước: quét AST mọi
 *      `requirePermission(<module>, …)` trên `server/**` cho **33** tên module, trong đó **6 tên
 *      KHÔNG có trong danh sách dưới** — `masterdata` · `dashboard_export` · `settings_workshop` ·
 *      `settings_production_line` · `settings_station` · `settings_workstation`. Tức lưới ấy sẽ
 *      **ĐỎ ngay lần chạy đầu**, và đóng nó là một **quyết định RBAC ngoài phạm vi VRAM** (mỗi tên
 *      hoặc là một "permission ma" phải seed, hoặc là một alias phải khai). Ghi vào sổ nợ, không
 *      vá lén ở đây.
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
 * Toàn bộ `moduleName` hợp lệ.
 *
 * ⚠⚠ **M-2 (review TOÀN NHÁNH 2026-08-06) — ĐÍNH CHÍNH LUẬT MÀ CHÍNH DANH SÁCH NÀY PHÁT BIỂU.**
 * Bản trước khai đây là *"mọi `moduleName` đã seed ở ≥1 role trong `DEFAULT_ROLE_PERMISSIONS`; giữ
 * đồng bộ với seed đó"*. **`vram_control` CỐ Ý VI PHẠM luật ấy** — nó **không bao giờ** vào khuôn
 * vai; đó là **toàn bộ điểm** của Task 3b (bit per-USER, chủ dự án duyệt từng người; xem
 * `VRAM_CONTROL_MODULE` dưới). Nên luật đúng là:
 *
 *   > Danh sách này là **tập tên module hợp lệ của hệ RBAC**. Phần lớn được seed ở ≥1 role trong
 *   > `DEFAULT_ROLE_PERMISSIONS`; một số **cố ý KHÔNG** (chỉ cấp per-USER) và mỗi ngoại lệ ấy phải
 *   > **nói ra lý do ngay tại dòng của nó**.
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
  // ★★★ Pha 5 Task 3b — BIT RIÊNG CHO MẶT LỆNH VRAM. Xem `VRAM_CONTROL_MODULE` bên dưới.
  "vram_control",
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

/**
 * ★★★ Pha 5 Task 3b — **MODULE QUYỀN CỦA MẶT LỆNH VRAM. MỘT chuỗi, MỘT chủ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO NÓ KHÔNG ĐƯỢC LÀ `machine_control/canDelete`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đếm được (Task 3b bước 1): `machine_control/canDelete` là sàn của **10 thủ tục ở 8 router**, và
 * **8/10 là `protectedProcedure` TRẦN** — không role-floor, không 2FA. Nguy hiểm nhất đích danh:
 * `programming.deleteProject` (`server/routers/programmingRouter.ts:261`) **xoá CASCADE cả cây mã
 * nguồn CÓ PHIÊN BẢN** (`programArtifacts`), không chốt an toàn, không OTP; cộng **5 bề mặt UI**
 * hiện nút xoá ngay khi cấp. Hai nút VRAM lại là **hai thủ tục CHẶT NHẤT** trong tập ấy
 * (`deployProcedure` = role-floor + 2FA + step-up).
 * ⚠⚠ **M-4 (review TOÀN NHÁNH 2026-08-06) — SỬA LỜI, KHÔNG SỬA MÃ: "OTP TƯƠI" LÀ NÓI QUÁ.**
 * `stepUpVerifiedUntil` (`server/_core/trpc.ts:279-283`) là một **cache 10 PHÚT theo
 * `sessionToken`**, **DÙNG CHUNG cho MỌI `deployProcedure` của hệ**. ⇒ một supervisor vừa step-up
 * cho `programming.deployBuild` thì `vram.preempt` chạy trong 10 phút **không hỏi OTP lần nào**.
 * Luận cứ tách bit vẫn đúng **tương đối** (8/10 thủ tục kia không có gì cả), nhưng đừng đọc câu
 * "chặt nhất" thành "mỗi lệnh một mã".
 * ⇒ Cấp bit dùng chung để mở **hai** cái chặt nhất sẽ mở luôn **tám** cái lỏng nhất.
 * **Chủ dự án chốt (2026-08-06): TÁCH BIT RIÊNG.**
 *
 * ⚠ Hình dạng đã chọn là **một `moduleName` mới**, KHÔNG phải một `action` mới: bảng `permissions`
 * có đúng **5 cột boolean cố định** (`drizzle/schema/auth.ts:62-67`) nên action thứ sáu là **DDL**,
 * còn `moduleName` là `varchar(100)` tự do ⇒ bit mới = **một HÀNG**, không migration. `category`
 * dùng lại giá trị `machine_control` đã có trong pgEnum ⇒ cũng không đụng enum.
 *
 * ⚠⚠ **KHÔNG có alias nào trỏ vào/ra khỏi tên này** (`PERMISSION_MODULE_ALIASES` dưới) — nếu thêm
 * một alias thì `checkPermission` sẽ resolve nó sang module khác và **phá đúng phép tách này**.
 *
 * Hai action đang dùng: `canDelete` (`vram.preempt` · `vram.releaseStale` — PHÁ HUỶ) và
 * `canCreate` (`vram.retryDeferred` — không phá huỷ). Mặt ĐỌC `vram.state` **cố ý** ở lại
 * `machine_control/canView` để bằng mức tool `get_vram_state` (quyết định N8 của chủ dự án).
 */
export const VRAM_CONTROL_MODULE = "vram_control" satisfies PermissionModule;

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
