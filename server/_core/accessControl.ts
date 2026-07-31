/**
 * Access Control Utilities
 * 
 * Provides:
 * 1. getAccessFilterConditions() - SQL conditions for data filtering by user assignments
 * 2. requirePermission() - tRPC middleware factory for module-level permission checks
 * 3. checkPermission() - Inline permission checker for ad-hoc use
 */

import { appError } from "./appError";
import { eq, and, inArray, or, SQL } from "drizzle-orm";
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
    // User has no assignments at all → deny all data
    return or()!; // empty or() produces FALSE
  }

  return or(...accessConditions)!;
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
