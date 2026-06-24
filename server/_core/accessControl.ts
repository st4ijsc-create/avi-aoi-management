/**
 * Access Control Utilities
 * 
 * Provides:
 * 1. getAccessFilterConditions() - SQL conditions for data filtering by user assignments
 * 2. requirePermission() - tRPC middleware factory for module-level permission checks
 * 3. checkPermission() - Inline permission checker for ad-hoc use
 */

import { TRPCError } from "@trpc/server";
import { eq, and, inArray, or, SQL } from "drizzle-orm";
import { productInspections } from "../../drizzle/schema";
import { getUserCorporateAssignments, getUserFactoryAssignments } from "../db/auth";
import { getDb } from "../db/connection";
import { permissions } from "../../drizzle/schema";
import { protectedProcedure } from "./trpc";
import { initTRPC } from "@trpc/server";
import type { TrpcContext } from "./context";

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
 * Check if user has a specific module permission.
 * Admin users always pass.
 */
export async function checkPermission(
  userId: number,
  userRole: string,
  moduleName: string,
  action: 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canExport',
): Promise<boolean> {
  if (userRole === 'admin') return true;

  const db = await getDb();
  if (!db) return false;

  const [perm] = await db
    .select()
    .from(permissions)
    .where(and(
      eq(permissions.userId, userId),
      eq(permissions.moduleName, moduleName),
    ))
    .limit(1);

  if (!perm) return false;

  // Check if permission has expired
  if (perm.expiresAt && perm.expiresAt < new Date()) return false;

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
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Bạn không có quyền ${action.replace('can', '').toLowerCase()} cho module "${moduleName}"`,
      });
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
