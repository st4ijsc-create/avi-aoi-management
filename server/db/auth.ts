import { eq, and, desc, like, sql, or, not, lte } from "drizzle-orm";
import { getDb } from "./connection";
import {
  InsertUser, users,
  backupCodes,
  userSessions, InsertUserSession,
  userCorporateAssignments, InsertUserCorporateAssignment,
  userFactoryAssignments, InsertUserFactoryAssignment,
} from "../../drizzle/schema";
import { ENV } from '../_core/env';
// ★★★ Pha 7 Task 8a — chủ duy nhất của mã dự phòng 2FA (sinh · băm · đối chiếu).
import { khopMaDuPhong } from '../_core/backupCodeSecret';
// W4-B (doc 27 B4): the auth layer caches session→user for AUTH_CACHE_TTL_S.
// Every mutation below that changes what authenticateRequest returns (role,
// isActive/ban, password, 2FA, session revocation) MUST explicitly evict the
// affected user's cached sessions so the change takes effect immediately on
// this instance (cross-instance propagation: Redis broadcast when available,
// otherwise bounded by the ≤TTL staleness window).
import { invalidateAuthUser } from '../services/authSessionCache';

export type UserRole = 'admin' | 'supervisor' | 'quality_inspector' | 'operator' | 'maintenance' | 'engineer' | 'viewer' | 'user';

// ============ USER FUNCTIONS ============
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });

    // Auth-cache invalidation — only when the CALLER changed profile fields
    // (OAuth sync / admin edit). The per-request lastSignedIn touch from
    // authenticateRequest passes none of these and must NOT evict the entry
    // it just created. (The owner auto-promotion above rewrites the same
    // 'admin' role every time — not a caller-driven change either.)
    if (
      user.role !== undefined ||
      user.name !== undefined ||
      user.email !== undefined ||
      user.loginMethod !== undefined
    ) {
      await invalidateAuthUser(undefined, user.openId);
    }
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function updateUserRole(userId: number, role: UserRole) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ role }).where(eq(users.id, userId));
  await invalidateAuthUser(userId); // role change must bite within this request
}

export async function deleteUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.delete(users).where(eq(users.id, userId));
  await invalidateAuthUser(userId);
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createLocalUser(data: {
  username: string;
  passwordHash: string;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  role?: UserRole;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Generate a unique openId for local users
  const openId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  
  const [result] = await db.insert(users).values({
    openId,
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    email: data.email || null,
    phone: data.phone || null,
    department: data.department || null,
    position: data.position || null,
    loginMethod: 'local',
    role: data.role || 'user',
    isActive: true,
  }).returning({ id: users.id });
  return { id: Number(result.id), openId };
}

export async function updateUser(userId: number, data: {
  name?: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  role?: UserRole;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set(data).where(eq(users.id, userId));
  await invalidateAuthUser(userId); // covers role change + ban (isActive:false)
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  await invalidateAuthUser(userId);
}

export async function getActiveUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.isActive, true)).orderBy(desc(users.createdAt));
}

export async function getUsersByRole(role: 'user' | 'admin') {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.role, role)).orderBy(desc(users.createdAt));
}

export async function getUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role?: 'user' | 'admin';
  username?: string;
  phone?: string;
  department?: string;
  position?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Hash password using bcrypt
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(data.password, 10);
  
  // Generate a unique openId for local users
  const openId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  
  const [result] = await db.insert(users).values({
    openId,
    username: data.username || data.email.split('@')[0],
    passwordHash,
    name: data.name,
    email: data.email,
    phone: data.phone || null,
    department: data.department || null,
    position: data.position || null,
    loginMethod: 'local',
    role: data.role || 'user',
    isActive: true,
  }).returning({ id: users.id });
  return Number(result.id);
}

export async function searchUsers(query: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users)
    .where(
      or(
        like(users.name, `%${query}%`),
        like(users.username, `%${query}%`),
        like(users.email, `%${query}%`)
      )
    )
    .orderBy(desc(users.createdAt));
}

// ============ 2FA FUNCTIONS ============
export async function setup2FA(userId: number, secret: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users)
    .set({ twoFactorSecret: secret })
    .where(eq(users.id, userId));
}

export async function enable2FA(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users)
    .set({ twoFactorEnabled: true })
    .where(eq(users.id, userId));
  await invalidateAuthUser(userId); // twoFactorEnabled gates adminProcedure
}

export async function disable2FA(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users)
    .set({ twoFactorSecret: null, twoFactorEnabled: false })
    .where(eq(users.id, userId));
  await invalidateAuthUser(userId);
}

export async function get2FAStatus(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({
    twoFactorEnabled: users.twoFactorEnabled,
    twoFactorSecret: users.twoFactorSecret,
  }).from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ============ BACKUP CODES ============
/**
 * ★★★ Pha 7 Task 8a — **`generateBackupCodes()` và `getBackupCodes()` ĐÃ BỊ XOÁ.**
 *
 *  · `generateBackupCodes(userId, codes)` ghi mã **PLAINTEXT** vào `backup_codes.code`, trong khi
 *    **cả hai** người đọc (`verifyBackupCode` dưới đây và `twoFactorRouter`) đối chiếu bằng
 *    `bcrypt.compare`. ⇒ Mã nó đẻ ra **không bao giờ xác minh được**, mà nó lại `DELETE` sạch bộ mã
 *    băm đang dùng được trước khi ghi: **bấm là mất mã thật, đổi lấy mã vô dụng** — vừa rò vừa hỏng.
 *  · `getBackupCodes(userId)` có **0 người gọi** và trả nguyên cột `code`.
 *
 * Đường ghi **duy nhất** còn lại: `twoFactorRouter` (`enable` · `regenerateBackupCodes`), cả hai
 * **đòi TOTP** và băm qua `server/_core/backupCodeSecret.ts`. Xoá hàm là chưa đủ — hàm mới mọc lại
 * ở file thứ N+1 — nên bất biến nằm ở **KIỂU** của cột (xem docstring của module ấy).
 */
export async function verifyBackupCode(userId: number, code: string) {
  const db = await getDb();
  if (!db) return false;

  // Get all unused backup codes for user
  const codes = await db.select()
    .from(backupCodes)
    .where(
      and(
        eq(backupCodes.userId, userId),
        eq(backupCodes.isUsed, false)
      )
    );

  // Đối chiếu qua chủ duy nhất (chuẩn hoá HOA + bcrypt.compare) — không giữ bản sao vị từ ở đây.
  for (const backupCode of codes) {
    const isMatch = await khopMaDuPhong(code, backupCode.code);
    if (isMatch) {
      // Mark as used
      await db.update(backupCodes)
        .set({ isUsed: true, usedAt: new Date() })
        .where(eq(backupCodes.id, backupCode.id));
      return true;
    }
  }
  
  return false;
}

export async function getUnusedBackupCodesCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` })
    .from(backupCodes)
    .where(
      and(
        eq(backupCodes.userId, userId),
        eq(backupCodes.isUsed, false)
      )
    );
  return result[0]?.count || 0;
}

// =====================================================
// User Sessions Functions
// =====================================================

export async function createUserSession(data: {
  userId: number;
  sessionToken: string;
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  location?: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) return 0;
  
  const [result] = await db.insert(userSessions).values(data).returning({ id: userSessions.id });
  return result.id;
}

export async function getUserSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.isActive, true)
      )
    )
    .orderBy(desc(userSessions.lastActivityAt));
}

export async function getSessionByToken(sessionToken: string) {
  const db = await getDb();
  if (!db) return null;
  
  const [session] = await db.select()
    .from(userSessions)
    .where(eq(userSessions.sessionToken, sessionToken))
    .limit(1);
  return session;
}

export async function updateSessionActivity(sessionId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(userSessions)
    .set({ lastActivityAt: new Date() })
    .where(eq(userSessions.id, sessionId));
}

export async function revokeSession(sessionId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(userSessions)
    .set({ isActive: false })
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId)
      )
    );
  // Coarse but safe: we only have the session id here, so evict ALL of the
  // user's cached sessions — the surviving ones re-cache on next request.
  await invalidateAuthUser(userId);
}

export async function revokeAllSessions(userId: number, exceptSessionId?: number) {
  const db = await getDb();
  if (!db) return;
  
  if (exceptSessionId) {
    await db.update(userSessions)
      .set({ isActive: false })
      .where(
        and(
          eq(userSessions.userId, userId),
          not(eq(userSessions.id, exceptSessionId))
        )
      );
  } else {
    await db.update(userSessions)
      .set({ isActive: false })
      .where(eq(userSessions.userId, userId));
  }
  await invalidateAuthUser(userId);
}

export async function cleanupExpiredSessions() {
  const db = await getDb();
  if (!db) return;
  
  await db.update(userSessions)
    .set({ isActive: false })
    .where(lte(userSessions.expiresAt, new Date()));
}

// ============ USER ASSIGNMENT FUNCTIONS ============

// User Assignment Functions
export async function getUserCorporateAssignments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const results = await db.select().from(userCorporateAssignments).where(eq(userCorporateAssignments.userId, userId));
  return results;
}

export async function getUserFactoryAssignments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const results = await db.select().from(userFactoryAssignments).where(eq(userFactoryAssignments.userId, userId));
  return results;
}

export async function createCorporateAssignment(data: InsertUserCorporateAssignment) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(userCorporateAssignments).values(data).returning({ id: userCorporateAssignments.id });
  return result;
}

export async function createFactoryAssignment(data: InsertUserFactoryAssignment) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(userFactoryAssignments).values(data).returning({ id: userFactoryAssignments.id });
  return result;
}

export async function deleteCorporateAssignment(userId: number, corporateCode: string) {
  const db = await getDb();
  if (!db) return null;
  
  await db.delete(userCorporateAssignments)
    .where(and(
      eq(userCorporateAssignments.userId, userId),
      eq(userCorporateAssignments.corporateCode, corporateCode)
    ));
  return true;
}

export async function deleteFactoryAssignment(userId: number, factoryCode: string) {
  const db = await getDb();
  if (!db) return null;
  
  await db.delete(userFactoryAssignments)
    .where(and(
      eq(userFactoryAssignments.userId, userId),
      eq(userFactoryAssignments.factoryCode, factoryCode)
    ));
  return true;
}

export async function reassignCorporate(userId: number, oldCorporateCode: string, newCorporateCode: string, assignedBy: number) {
  const db = await getDb();
  if (!db) return null;
  
  await db.delete(userCorporateAssignments)
    .where(and(
      eq(userCorporateAssignments.userId, userId),
      eq(userCorporateAssignments.corporateCode, oldCorporateCode)
    ));
  const [result] = await db.insert(userCorporateAssignments).values({
    userId,
    corporateCode: newCorporateCode,
    assignedBy,
  }).returning({ id: userCorporateAssignments.id });
  return result;
}

export async function reassignFactory(userId: number, oldFactoryCode: string, newFactoryCode: string, assignedBy: number) {
  const db = await getDb();
  if (!db) return null;
  
  await db.delete(userFactoryAssignments)
    .where(and(
      eq(userFactoryAssignments.userId, userId),
      eq(userFactoryAssignments.factoryCode, oldFactoryCode)
    ));
  const [result] = await db.insert(userFactoryAssignments).values({
    userId,
    factoryCode: newFactoryCode,
    assignedBy,
  }).returning({ id: userFactoryAssignments.id });
  return result;
}

// Helper to check if user has access to corporate/factory
export async function hasAccessToCorporate(userId: number, corporateCode: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // Admin has access to all
  const user = await getUserById(userId);
  if (user?.role === 'admin') return true;
  
  const assignments = await db.select()
    .from(userCorporateAssignments)
    .where(and(
      eq(userCorporateAssignments.userId, userId),
      eq(userCorporateAssignments.corporateCode, corporateCode)
    ))
    .limit(1);
  
  return assignments.length > 0;
}

export async function hasAccessToFactory(userId: number, factoryCode: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Admin has access to all
  const user = await getUserById(userId);
  if (user?.role === 'admin') return true;

  const assignments = await db.select()
    .from(userFactoryAssignments)
    .where(and(
      eq(userFactoryAssignments.userId, userId),
      eq(userFactoryAssignments.factoryCode, factoryCode)
    ))
    .limit(1);

  return assignments.length > 0;
}

/**
 * Update brute-force lockout counters.
 * Pass attempts=0 and lockedUntil=null to reset after a successful login.
 */
export async function updateUserLoginAttempts(
  userId: number,
  attempts: number,
  lockedUntil: Date | null,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users)
    .set({ loginAttempts: attempts, lockedUntil })
    .where(eq(users.id, userId));
}
