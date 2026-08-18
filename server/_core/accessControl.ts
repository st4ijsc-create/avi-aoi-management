/**
 * Access Control Utilities
 * 
 * Provides:
 * 1. getAccessFilterConditions() - SQL conditions for data filtering by user assignments
 * 2. requirePermission() - tRPC middleware factory for module-level permission checks
 * 3. checkPermission() - Inline permission checker for ad-hoc use
 */

import { appError } from "./appError";
import { eq, and, inArray, or, sql, SQL } from "drizzle-orm";
import { productInspections } from "../../drizzle/schema";
import { getUserCorporateAssignments, getUserFactoryAssignments } from "../db/auth";
import { getDb } from "../db/connection";
import { permissions } from "../../drizzle/schema";
import { protectedProcedure } from "./trpc";
import { initTRPC } from "@trpc/server";
import type { TrpcContext } from "./context";
// doc 40 Lan-P0/DEV-02 — resolve "permission ma" (moduleName = category `machine_monitoring`)
// về module THẬT (machine_status) tại một điểm trung tâm. Sửa MỌI gate `machine_monitoring`
// trên toàn server (kể cả router chưa đụng tới) mà không cần migration.
import { resolvePermissionModule } from "@shared/permissions";

// Cache for user assignments (per-request, short-lived)
const assignmentCache = new Map<string, { corporateCodes: string[]; factoryCodes: string[]; timestamp: number }>();
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Get the user's corporate and factory codes with caching.
 * Admin users get empty arrays (meaning no filter = access to all).
 */
export async function getUserAssignmentCodes(userId: number, userRole: string): Promise<{
  corporateCodes: string[];
  factoryCodes: string[];
  isAdmin: boolean;
}> {
  if (userRole === 'admin') {
    return { corporateCodes: [], factoryCodes: [], isAdmin: true };
  }

  const cacheKey = `${userId}`;
  const cached = assignmentCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { ...cached, isAdmin: false };
  }

  const [corporateAssignments, factoryAssignments] = await Promise.all([
    getUserCorporateAssignments(userId),
    getUserFactoryAssignments(userId),
  ]);

  const corporateCodes = corporateAssignments.map(a => a.corporateCode);
  const factoryCodes = factoryAssignments.map(a => a.factoryCode);

  assignmentCache.set(cacheKey, { corporateCodes, factoryCodes, timestamp: Date.now() });

  return { corporateCodes, factoryCodes, isAdmin: false };
}

/**
 * Tenant scope for DB-level Row-Level Security (Phase 1 WS1.2/WS4).
 * Mirrors getUserAssignmentCodes into the shape consumed by
 * server/db/tenantContext.ts `withTenantScope` (admin → bypass).
 */
export async function getTenantScope(
  userId: number,
  userRole: string,
): Promise<{ bypass: boolean; corporateCodes: string[]; factoryCodes: string[] }> {
  const { corporateCodes, factoryCodes, isAdmin } = await getUserAssignmentCodes(userId, userRole);
  return { bypass: isAdmin, corporateCodes, factoryCodes };
}

/**
 * ⚠⚠⚠ 2026-08-17 — VỊ TỪ FALSE TƯỜNG MINH. Đừng thay bằng `or()`.
 *
 * Mã cũ ở đây là `return or()!;` kèm chú thích *"empty or() produces FALSE"*. **Chú thích ấy
 * SAI.** `drizzle-orm/sql/expressions/conditions.js`:
 *
 *     const conditions = unfilteredConditions.filter(c => c !== void 0);
 *     if (conditions.length === 0) return void 0;      // ← undefined, KHÔNG phải FALSE
 *
 * Dấu `!` (non-null assertion) dập tắt đúng cái cảnh báo TypeScript lẽ ra đã chỉ vào chỗ này.
 * Cả 10 điểm gọi đều viết `if (accessFilter) conditions.push(accessFilter)`, nên `undefined`
 * = **KHÔNG có mệnh đề WHERE** = **thấy TẤT CẢ** — ngược hẳn hợp đồng mà docblock tự khai.
 * Đo được ngày 2026-08-17 trên `aoi_management` (chạy chính mã này, trước/sau bản vá):
 * `supervisor1`/`operator1`/`maint1`/`p1_audit_op` (0 gán nhà máy) đọc được **22.996/22.996**
 * bản ghi kiểm — tức TOÀN BỘ, kể cả hàng không mang mã tenant. Sau bản vá: **0/22.996**.
 * Đối chứng DƯƠNG giữ nguyên: `admin` 22.996 (không lọc) và `engineer1` (gán `SIM-FAC`)
 * 22.995 — vẫn đúng bằng phạm vi của nó, KHÔNG bị vá quá tay.
 *
 * `accessControlScope.test.ts` NEO thẳng vào giá trị trả về (`expect(filter).toBeDefined()`),
 * không chỉ canh kết quả truy vấn — hoàn nguyên về `or()!` là ĐỎ ngay, không cần tới CSDL.
 */
const DENY_ALL_ROWS: SQL = sql`1 = 0`;

// Nhãn "phạm vi rỗng" sống ở một module KHÔNG phụ thuộc để `server/db/**` nhập TĨNH được mà
// không tạo vòng import qua `_core/trpc` — re-export ở đây để nơi gọi cũ không phải đổi đường.
export {
  SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT,
  NO_FACTORY_ASSIGNMENT_MESSAGE,
  UNSCOPED_LABELS,
  scopeLabelsOf,
  withScopeLabels,
} from "./accessControlLabels";
export type { ScopeEmptyReason, ScopeLabels, ScopedRows } from "./accessControlLabels";

import {
  SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT,
  NO_FACTORY_ASSIGNMENT_MESSAGE,
  type ScopeLabels,
} from "./accessControlLabels";

export interface ResolvedDataScope extends ScopeLabels {
  /** Điều kiện SQL thu hẹp về tenant của người gọi. `undefined` = vai toàn quyền. */
  filter: SQL | undefined;
}

/**
 * Bộ phân giải phạm vi DÙNG CHUNG cho các bề mặt đọc bản ghi kiểm: vừa trả điều kiện SQL,
 * vừa trả câu giải thích để giao diện KHÔNG được phép trình bày phạm vi rỗng thành
 * "không có dữ liệu". Khuôn theo `services/defectSpatialHeatmap.ts` (bản vá đã làm đúng).
 */
export async function resolveDataScope(
  userId: number,
  userRole: string,
): Promise<ResolvedDataScope> {
  const { corporateCodes, factoryCodes, isAdmin } = await getUserAssignmentCodes(userId, userRole);
  const noAssignment = !isAdmin && corporateCodes.length === 0 && factoryCodes.length === 0;
  const filter = await getAccessFilterConditions(userId, userRole);

  return {
    filter,
    scopeApplied: filter !== undefined,
    scopeEmptyReason: noAssignment ? SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT : null,
    scopeMessage: noAssignment ? NO_FACTORY_ASSIGNMENT_MESSAGE : null,
  };
}

/**
 * Build SQL access filter conditions for the productInspections table.
 *
 * - Admin users: returns undefined (no filter).
 * - Non-admin with assignments: returns OR condition matching corporate/factory codes.
 * - Non-admin with NO assignments: returns a condition that matches nothing (1=0).
 *
 * @returns SQL condition to AND into the query's where clause, or undefined for admin
 */
export async function getAccessFilterConditions(
  userId: number,
  userRole: string,
): Promise<SQL | undefined> {
  const { corporateCodes, factoryCodes, isAdmin } = await getUserAssignmentCodes(userId, userRole);

  if (isAdmin) {
    return undefined; // Admin sees everything
  }

  const accessConditions: SQL[] = [];

  if (corporateCodes.length > 0) {
    accessConditions.push(inArray(productInspections.corporateCode, corporateCodes));
  }
  if (factoryCodes.length > 0) {
    accessConditions.push(inArray(productInspections.factoryCode, factoryCodes));
  }

  if (accessConditions.length === 0) {
    // User has no assignments at all → deny all data.
    // ⚠ KHÔNG dùng `or()` ở đây — xem docblock của DENY_ALL_ROWS ở trên.
    return DENY_ALL_ROWS;
  }

  // `accessConditions` chắc chắn có ≥1 phần tử ở nhánh này nên `or()` không thể trả undefined;
  // kiểu trả về của hàm đã là `SQL | undefined` nên KHÔNG cần `!` (dấu `!` chính là thứ đã che
  // mất lỗi ở nhánh rỗng phía trên — không tái lập nó ở đây).
  return or(...accessConditions);
}

/**
 * doc 48 R4 — SCOPED ADMIN. Historically `admin` short-circuits every permission
 * check (`admin=god`), so admin authority could never be scoped or audited per
 * module. When RBAC_SCOPED_ADMIN=true, admin is instead subject to EXPLICIT
 * restriction: an admin still passes a module UNLESS a permission row exists that
 * denies that action (row present with action=false). No row / expired row /
 * DB-down → admin still passes (never lock an admin out of an unconfigured
 * module). This makes admin authority restrictable + auditable without any
 * lockout risk, and is a no-op for non-admins. Default OFF preserves the exact
 * legacy behaviour.
 */
function scopedAdminEnabled(): boolean {
  return process.env.RBAC_SCOPED_ADMIN === 'true';
}

/**
 * Check if user has a specific module permission.
 * Admin users pass by default (legacy) or are subject to explicit restriction
 * rows when RBAC_SCOPED_ADMIN=true (see scopedAdminEnabled).
 */
export async function checkPermission(
  userId: number,
  userRole: string,
  moduleName: string,
  action: 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canExport',
): Promise<boolean> {
  const isAdmin = userRole === 'admin';
  // Legacy god-mode (default): admin short-circuits. Non-admins fall through.
  if (isAdmin && !scopedAdminEnabled()) return true;

  const db = await getDb();
  // DB unavailable: deny non-admins (unchanged); never lock a scoped-admin out.
  if (!db) return isAdmin;

  // doc 40 — áp alias: `machine_monitoring` (category dùng nhầm làm module) → `machine_status`.
  const resolvedModule = resolvePermissionModule(moduleName);

  const [perm] = await db
    .select()
    .from(permissions)
    .where(and(
      eq(permissions.userId, userId),
      eq(permissions.moduleName, resolvedModule),
    ))
    .limit(1);

  // No explicit grant: non-admin denied (unchanged); scoped-admin still passes
  // (unconfigured module must never lock an admin out).
  if (!perm) return isAdmin;

  // Expired grant: treat as no restriction for admin; denial for non-admin.
  if (perm.expiresAt && perm.expiresAt < new Date()) return isAdmin;

  // An explicit row is authoritative for BOTH: a false action now genuinely
  // restricts a scoped-admin (the whole point), a true action allows.
  return perm[action] === true;
}

/**
 * tRPC middleware factory that checks module-level permissions.
 * Usage: protectedProcedure.use(requirePermission('history_view', 'canView'))
 */
export function requirePermission(moduleName: string, action: 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canExport') {
  return async ({ ctx, next }: { ctx: TrpcContext & { user: NonNullable<TrpcContext['user']> }; next: Function }) => {
    const hasAccess = await checkPermission(
      ctx.user.id,
      ctx.user.role,
      moduleName,
      action,
    );

    if (!hasAccess) {
      // Task 10 (F3, doc71) — `requirePermission` là middleware DÙNG CHUNG, gọi
      // từ ~687 call site (`server/routers/**`) với (moduleName, action) khác
      // nhau ở MỖI chỗ. `moduleName` là cột varchar tự do (permissions.moduleName,
      // KHÔNG phải enum cố định — DB-driven, không thể liệt kê hết vào từ điển
      // camelCase mà không tạo một từ điển khổng lồ phải bảo trì song song với
      // DB) nên KHÔNG đưa vào `action`/`reason` — giữ nguyên trong
      // fallbackMessage (mất khi client đã dịch, disclosure ở task-10-report.md).
      // `action` ('canView'|'canCreate'|'canEdit'|'canDelete'|'canExport') NGƯỢC
      // LẠI là một union 5 giá trị CỐ ĐỊNH trong chữ ký hàm — dịch được đầy đủ,
      // nên dùng chính giá trị đó (đã camelCase sẵn) làm khoá `action`.
      throw appError(
        "FORBIDDEN",
        "PERMISSION_DENIED",
        { action },
        `Bạn không có quyền ${action.replace('can', '').toLowerCase()} cho module "${moduleName}"`,
      );
    }

    return next({ ctx });
  };
}

/**
 * Invalidate the assignment cache for a user (call when assignments change).
 */
export function invalidateAssignmentCache(userId: number) {
  assignmentCache.delete(`${userId}`);
}

/**
 * Clear entire assignment cache.
 */
export function clearAssignmentCache() {
  assignmentCache.clear();
}
