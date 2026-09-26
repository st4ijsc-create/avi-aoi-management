/**
 * Tenant context for Row-Level Security (Phase 1 WS1.2).
 *
 * STAGED CAPABILITY — not yet wired into the request path. Activate together
 * with drizzle/optional/0001_tenant_rls.sql once the app connects as a
 * non-owner DB role and the rollout has been tested on staging.
 *
 * RLS policies read per-connection GUCs. Because the app uses a shared
 * connection pool, the context must be set with `SET LOCAL` inside a
 * transaction (via set_config(..., is_local => true)) so it never leaks to
 * another request reusing the connection. Use `withTenantScope` to run a unit
 * of work under a tenant context.
 *
 * Example wiring (future, per authenticated request):
 *   await withTenantScope(db, scopeFromUser(ctx.user), async (tx) => {
 *     return tx.select().from(productInspections)...;
 *   });
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";

export interface TenantScope {
  /** Admin / service: bypass tenant filtering (see all rows). */
  bypass?: boolean;
  /** Factory codes this scope may access. */
  factoryCodes?: string[];
  /** Corporate codes this scope may access. */
  corporateCodes?: string[];
}

type DbLike = {
  transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T>;
};
type TxLike = { execute: (q: unknown) => Promise<unknown> };

/** Apply the tenant GUCs on a transaction handle (SET LOCAL semantics). */
export async function applyTenantContext(tx: TxLike, scope: TenantScope): Promise<void> {
  const factories = (scope.factoryCodes ?? []).join(",");
  const corporates = (scope.corporateCodes ?? []).join(",");
  // set_config(key, value, is_local=true) == SET LOCAL — scoped to this tx.
  // Setting tenant_rls_active='on' activates the RLS policies for THIS tx only;
  // outside a tenant scope the policies stay inert (default-allow), so enabling
  // RLS at the table level never breaks unscoped queries.
  await tx.execute(sql`SELECT set_config('app.tenant_rls_active', 'on', true)`);
  await tx.execute(sql`SELECT set_config('app.tenant_bypass', ${scope.bypass ? "on" : "off"}, true)`);
  await tx.execute(sql`SELECT set_config('app.tenant_factory_codes', ${factories}, true)`);
  await tx.execute(sql`SELECT set_config('app.tenant_corporate_codes', ${corporates}, true)`);
}

/** Run `fn` inside a transaction with the tenant context applied. */
export async function withTenantScope<T>(
  db: DbLike,
  scope: TenantScope,
  fn: (tx: TxLike) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await applyTenantContext(tx, scope);
    return fn(tx);
  });
}

/**
 * Is DB-level tenant RLS enforcement enabled? Read at call time (not module
 * load) so tests / operators can flip it without a process restart.
 *
 * SAFETY: default OFF. When OFF, `runWithTenantScope` is a pure pass-through —
 * it never opens a transaction and never sets any GUC, so the request path is
 * byte-for-byte the legacy behaviour (zero risk, zero cost).
 */
export function isTenantRlsEnabled(): boolean {
  return process.env.TENANT_RLS_ENABLED === "true";
}

/**
 * FLAG-GATED entry point for the data layer.
 *
 * - Flag OFF (default): runs `fn(db)` directly — NO transaction, NO GUCs.
 *   Identical to calling the query on the global pool. This is what keeps the
 *   app safe while RLS is dormant.
 * - Flag ON: runs `fn` inside `withTenantScope(db, scope, fn)` so the
 *   per-transaction GUCs (`SET LOCAL`) activate the RLS policies for exactly
 *   that unit of work on exactly the connection the transaction holds.
 *
 * CONNECTION-MODEL CAVEAT (read server/db/connection.ts): the app uses a SHARED
 * postgres-js pool (max 10). A GUC set with plain `SET` would leak to whichever
 * request next reuses that pooled connection. That is why enforcement MUST go
 * through a transaction with `SET LOCAL` (set_config(..., is_local => true)) —
 * the GUC is bound to the transaction and discarded on COMMIT/ROLLBACK. It is
 * therefore NOT possible to "set the GUC once in middleware for the whole
 * request" on this pool; enforcement is opt-in at the query site via this
 * helper. Middleware only derives the scope (ctx.tenantScope); the data layer
 * decides when to enforce. Tables whose queries are not yet wrapped here remain
 * unenforced even with the flag ON — adoption is incremental and table-by-table.
 */
export async function runWithTenantScope<T>(
  db: DbLike & { transaction: DbLike["transaction"] },
  scope: TenantScope,
  fn: (handle: TxLike) => Promise<T>,
): Promise<T> {
  if (!isTenantRlsEnabled()) {
    // No-op fast path: run against the passed handle with no tx / no GUCs.
    return fn(db as unknown as TxLike);
  }
  return withTenantScope(db, scope, fn);
}

// ═══════════════════════════════════════════════════════════════════════════
// NỐI VÀO ĐƯỜNG DỮ LIỆU (2026-08-18)
//
// Cho tới hôm nay `runWithTenantScope` có **0 nơi gọi trong mã sản xuất**: cờ
// `TENANT_RLS_ENABLED=true` mua được ĐÚNG SỐ KHÔNG. Phần dưới là cái nối.
//
// ── VÌ SAO KHÔNG NỐI Ở TẦNG KẾT NỐI ────────────────────────────────────────
// `server/db/connection.ts` dùng pool postgres-js dùng chung (mặc định max 25).
// GUC đặt bằng `SET` thường sẽ RÒ sang request kế tiếp mượn đúng connection đó.
// Cách duy nhất an toàn là `SET LOCAL` **trong một giao dịch**, mà giao dịch thì
// không thể "mở sẵn cho cả request" trên pool này. ⇒ điểm nối bắt buộc phải là
// nơi BIẾT ranh giới một đơn vị công việc, không phải tầng kết nối.
//
// ── ĐIỂM NỐI THỰC TẾ (hai nửa) ─────────────────────────────────────────────
//  (1) `server/_core/trpc.ts` — middleware đã tính sẵn phạm vi; nay nó ĐẶT phạm
//      vi ấy vào `AsyncLocalStorage` cho suốt vòng đời request. Đây là nơi DUY
//      NHẤT trong hệ có danh tính người gọi.
//  (2) `chayTheoPhamViTenantHienTai(db, fn)` — tầng dữ liệu gọi hàm này thay cho
//      việc truy vấn thẳng. Nó ĐỌC danh tính từ ALS, tự quyết định có cưỡng chế
//      hay không, rồi mở giao dịch + bật GUC.
// Nhờ ALS, tầng dữ liệu KHÔNG phải đổi chữ ký hàm để nhận `ctx` — đó là lý do
// chọn ALS thay vì luồn tham số qua hàng trăm hàm.
// ═══════════════════════════════════════════════════════════════════════════

const khoDanhTinhTenant = new AsyncLocalStorage<TenantScope>();

/**
 * Đặt danh tính tenant cho toàn bộ nhánh async bên trong `fn`.
 * Gọi ở `server/_core/trpc.ts` (một lần cho mỗi request đã xác thực).
 */
export function chayVoiDanhTinhTenant<T>(scope: TenantScope, fn: () => T): T {
  return khoDanhTinhTenant.run(scope, fn);
}

/** Phạm vi tenant của người gọi hiện tại, hoặc `undefined` nếu KHÔNG mang danh tính. */
export function layPhamViTenantHienTai(): TenantScope | undefined {
  return khoDanhTinhTenant.getStore();
}

/** Vì sao một đơn vị công việc KHÔNG được cưỡng chế ở tầng CSDL. */
export type LyDoKhongCuongChe =
  /** `TENANT_RLS_ENABLED` chưa bật — hành vi y hệt trước khi có việc này. */
  | "co-tat"
  /** Không có danh tính: tác vụ nền, cron, MQTT/edge, khoá master server-to-server. */
  | "khong-danh-tinh"
  /** Đã đăng nhập, KHÔNG bypass, nhưng KHÔNG được gán mã tenant nào. Xem giải thích dưới. */
  | "pham-vi-rong";

export interface QuyetDinhCuongChe {
  cuongChe: boolean;
  lyDo?: LyDoKhongCuongChe;
}

/**
 * ⚠⚠ CỔNG AN TOÀN — ĐỌC PHẦN "phạm vi rỗng" TRƯỚC KHI GỠ.
 *
 * ── "pham-vi-rong": vì sao KHÔNG cưỡng chế khi danh sách mã RỖNG ────────────
 * ĐO ĐƯỢC 2026-08-18 trên `aoi_management`, chạy bằng ĐÚNG vai ứng dụng
 * `avi_app`, đặt `app.tenant_rls_active='on'`, `bypass='off'`, danh sách mã
 * để RỖNG (đúng phạm vi mà `getTenantScope` trả về cho `operator1`,
 * `supervisor1`, `maint1` — ba tài khoản này có **0 dòng** trong
 * `user_factory_assignments`):
 *
 *     suppliers 5→0 · materials 20→0 · customers 3→0 · tools 8→0
 *     device_types 31→0 · alarm_taxonomy 175→0 · … (cả 40 bảng → 0)
 *
 * Danh sách rỗng không phải "phạm vi hẹp" — nó là **KHÔNG BIẾT** người này thuộc
 * tenant nào. Biến "không biết" thành "cấm tất" ở tầng CSDL cho ra một màn hình
 * TRẮNG TRƠN, không kèm lời giải thích nào, vì RLS lọc IM LẶNG: truy vấn vẫn
 * thành công, chỉ là 0 hàng. Giao diện sẽ trình bày đúng cái đó thành
 * "không có dữ liệu" — sai sự thật.
 *
 * Quyết định "người chưa được gán nhà máy thấy gì" ĐÃ CÓ CHỖ CỦA NÓ và chỗ đó
 * làm ĐÚNG: `server/_core/accessControl.ts` (`DENY_ALL_ROWS` +
 * `SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT` + `NO_FACTORY_ASSIGNMENT_MESSAGE`) chặn ở
 * tầng ứng dụng VÀ trả về một câu giải thích cho người dùng. RLS không có kênh
 * nào để nói câu đó. ⇒ tầng CSDL nhường quyết định này cho tầng ứng dụng.
 *
 * HỆ QUẢ ĐƯỢC KHAI BÁO THẲNG: tài khoản không được gán nhà máy KHÔNG có hàng rào
 * CSDL. Họ cũng KHÔNG có hàng rào ấy trước việc này (GUC chưa từng được bật) —
 * nên đây là "chưa phủ", không phải "thụt lùi". Muốn phủ nốt: gán nhà máy cho họ,
 * hoặc để tầng ứng dụng từ chối như nó đang làm.
 */
export function quyetDinhCuongChe(scope: TenantScope | undefined): QuyetDinhCuongChe {
  if (!isTenantRlsEnabled()) return { cuongChe: false, lyDo: "co-tat" };
  if (!scope) return { cuongChe: false, lyDo: "khong-danh-tinh" };
  // admin / dịch vụ: vẫn chạy trong giao dịch, đặt `app.tenant_bypass='on'`.
  // Đo được: bypass ⇒ thấy ĐỦ hàng trên cả 42 bảng. Giữ nhánh này CHẠY THẬT (thay
  // vì đi tắt) để đường đi của admin được lưới kiểm tra bao phủ y như người thường.
  if (scope.bypass) return { cuongChe: true };
  const soMa = (scope.factoryCodes?.length ?? 0) + (scope.corporateCodes?.length ?? 0);
  if (soMa === 0) return { cuongChe: false, lyDo: "pham-vi-rong" };
  return { cuongChe: true };
}

/**
 * ĐIỂM NỐI của tầng dữ liệu.
 *
 * Chạy `fn` dưới phạm vi tenant của NGƯỜI GỌI HIỆN TẠI (lấy từ ALS).
 * - Cưỡng chế được ⇒ mở giao dịch, `SET LOCAL` bốn GUC, chạy `fn(tx)`.
 * - Không cưỡng chế được (cờ tắt / không danh tính / phạm vi rỗng) ⇒ chạy
 *   `fn(db)` THẲNG, không giao dịch, không GUC — **byte-for-byte như hôm nay**.
 *
 * Lối đi KHÔNG mang danh tính (tác vụ nền, cron, MQTT/edge ingest, khoá master
 * server-to-server, migration) không bao giờ vào được ALS ⇒ luôn rơi vào nhánh
 * pass-through ⇒ **tiếp tục chạy, không chết**. Đó là hợp đồng, không phải may.
 */
export async function chayTheoPhamViTenantHienTai<TDb, T>(
  db: TDb,
  fn: (handle: TDb) => Promise<T>,
): Promise<T> {
  const scope = layPhamViTenantHienTai();
  const { cuongChe } = quyetDinhCuongChe(scope);
  if (!cuongChe || !scope) return fn(db);
  // `handle` được khai kiểu BẰNG kiểu của `db` để nơi gọi viết truy vấn drizzle
  // y hệt lúc chưa bọc (`h.select().from(tools)…`). Ở runtime nó là handle giao
  // dịch của drizzle — cùng bề mặt dựng truy vấn, khác ở chỗ mọi câu lệnh đi trên
  // ĐÚNG một connection, đúng cái mà `SET LOCAL` cần. Ép kiểu ở ĐÂY, một chỗ, để
  // không nơi gọi nào phải ép.
  return withTenantScope(db as unknown as DbLike, scope, (tx) => fn(tx as unknown as TDb));
}
