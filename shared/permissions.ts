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
  /**
   * ★★★ doc 78 PHA A (2026-08-18) — **BIT RIÊNG CHO "AI ĐỌC MÃ NGUỒN NỀN TẢNG".**
   *
   * Chủ dự án chốt: ba tool `read_file`/`list_files`/`grep_repo` ghim theo vai `engineer`/`admin`.
   * ĐO trên `DEFAULT_ROLE_PERMISSIONS`: trong 20 module `engineer` giữ, đúng HAI cái không ai khác
   * giữ (`settings_factory`, `settings_measurement_points`) — mượn một trong hai là neo theo TẬP
   * VAI chứ không theo NGHĨA, và ngày ai đó cấp `settings_factory` cho `supervisor` thì quyền đọc
   * mã nguồn mở theo trong im lặng. Cùng lý lẽ đã dựng `vram_control` ⇒ một `moduleName` mới
   * (`varchar(100)` tự do ⇒ một HÀNG, không DDL; `category` dùng lại `settings` đã có trong pgEnum).
   * Seed: `admin` + `engineer` (0330 backfill cho tài khoản cũ).
   * ⚠ KHÔNG được thêm alias trỏ vào/ra tên này — alias sẽ resolve nó sang module khác và phá đúng
   *   phép tách này (cùng cảnh báo đã ghi ở `VRAM_CONTROL_MODULE`).
   */
  "ai_repo_read",
  /**
   * ★★★ doc 78 PHA B (2026-08-18) — **AI CHẠY LỆNH trong danh sách TRẮNG** (`run_command`).
   *
   * MODULE RIÊNG, không phải một `action` khác của `ai_repo_read`. Lý do là một phép đo về **chỗ
   * quyền được cấp**, không phải sở thích đặt tên: một `moduleName` = MỘT HÀNG `permissions` với
   * năm ô tick, nên gộp chung nghĩa là một lượt "cấp cho đủ" trên dòng *"AI đọc mã nguồn"* sẽ mở
   * quyền **SINH TIẾN TRÌNH trên máy chủ** trong im lặng — đúng chế độ hỏng mà mig 0330 viết ra để
   * tránh. Thêm nữa, câu từ chối nêu đích danh `module/action`, nên `ai_repo_read/canCreate` cho một
   * người vừa xin **chạy test** là một lời khai SAI về lý do.
   * ⚠ Mig 0330 đã đặt trước `ai_repo_read/canEdit` cho PHA C (ghi tệp) — đọc/ghi **cùng một đối
   *   tượng** thì đúng là chỗ dùng hai `action` trên một `module`. Chạy lệnh là **đối tượng KHÁC**
   *   (tiến trình, CPU, thời gian máy). Tiền lệ trực tiếp: `vram_control` tách khỏi mặt đọc VRAM.
   * Chỉ `canCreate` ("tạo một lượt chạy"). Seed: `admin` + `engineer` (0331 backfill).
   * ⚠ KHÔNG được thêm alias trỏ vào/ra tên này — alias sẽ resolve nó sang module khác và phá đúng
   *   phép tách này (cùng cảnh báo ở `ai_repo_read` và `VRAM_CONTROL_MODULE`).
   */
  "ai_repo_exec",
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
 * ⚠⚠ **M-4 — ĐÃ VÁ Ở PHA 6 TASK 1 (SỬA MÃ, không chỉ sửa lời).** Pha 5 ghi nhận
 * `stepUpVerifiedUntil` (`server/_core/trpc.ts`) là **cache 10 PHÚT theo `sessionToken`, DÙNG
 * CHUNG cho MỌI `deployProcedure`**; nghiệm thu sống đo được `vram.preempt` **không `totpCode`**
 * vẫn qua. Nay hai lệnh phá huỷ VRAM chain thêm `requirePerCallFreshTotp` ⇒ **mỗi lệnh một mã**,
 * đúng như câu này nói.
 * ⚠ **Cập nhật Pha 6 Task 1b (`a9f155f9`) — câu ở đây từng nói *"Năm `deployProcedure` khác của hệ
 * VẪN dùng cache phiên"*, và nó đã SAI SỰ THẬT kể từ commit ấy** (bắt ở review Task 1b, I-5): phép
 * siết được đưa vào **GỐC** `server/_core/trpc.ts:549`
 * (`actuationProcedure.use(requireFreshTotp).use(requirePerCallFreshTotp)`), nên **CẢ BẢY** thủ
 * tục đứng trên `deployProcedure` — không riêng hai lệnh VRAM — đều đòi OTP **mỗi lượt gọi**.
 * ⚠⚠ Điều đó **KHÔNG** làm phép tách bit dưới đây thừa: lý lẽ của nó là **so sánh** giữa hai lệnh
 * VRAM và **tám thủ tục `protectedProcedure` TRẦN** cùng đeo `machine_control/canDelete` (8/10 —
 * không role-floor, không 2FA, không step-up). Tám cái ấy **không** đứng trên `deployProcedure` và
 * **không** được lượt siết trên chạm tới; khoảng cách vì thế **rộng ra**, không hẹp lại.
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
