import { eq, and, desc, like, sql, or, not, lte } from "drizzle-orm";
import { getDb } from "./connection";
import {
  InsertUser, users,
  userSecrets,
  backupCodes,
  userSessions, InsertUserSession,
  userCorporateAssignments, InsertUserCorporateAssignment,
  userFactoryAssignments, InsertUserFactoryAssignment,
} from "../../drizzle/schema";
// ★★★ Pha 7 Task 9 (9b) — vị từ "phải đổi mật khẩu" có MỘT chủ; đừng viết bản sao thứ hai ở đây.
import { suyRaPhaiDoiMatKhau, type MocMatKhau } from "../_core/publicUser";
import { ENV } from '../_core/env';
// ★★★ Pha 7 Task 8a — chủ duy nhất của mã dự phòng 2FA (sinh · băm · đối chiếu).
import { khopMaDuPhong } from '../_core/backupCodeSecret';
// ★★★★ Review TOÀN NHÁNH Pha 8 C-2 — trần cột SUY TỪ SCHEMA, không phải một con số viết tay.
import { catTheoTranCot } from './catTheoTranCot';
// W4-B (doc 27 B4): the auth layer caches session→user for AUTH_CACHE_TTL_S.
// Every mutation below that changes what authenticateRequest returns (role,
// isActive/ban, password, 2FA, session revocation) MUST explicitly evict the
// affected user's cached sessions so the change takes effect immediately on
// this instance (cross-instance propagation: Redis broadcast when available,
// otherwise bounded by the ≤TTL staleness window).
import { invalidateAuthSession, invalidateAuthUser } from '../services/authSessionCache';

export type UserRole = 'admin' | 'supervisor' | 'quality_inspector' | 'operator' | 'maintenance' | 'engineer' | 'viewer' | 'user';

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 7 Task 9 (9c) — **CỬA DUY NHẤT tới `user_secrets`.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mọi lượt đọc/ghi `passwordHash` · `twoFactorSecret` đi qua **ba** hàm dưới đây. Đó là điều kiện
 * để lớp lỗi *"hai người ghi dưới một bất biến"* (đã đẻ **ba** Critical trong chuỗi pha) không
 * mọc lại: trước Task 9 hai cột ấy có **4 người ghi mã + 4 người ghi script**, rải trên 5 file.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Hình dạng bí mật của một tài khoản. `null` ở cả hai ô là hợp lệ (tài khoản SSO chưa bật 2FA). */
export type BiMatNguoiDung = { passwordHash: string | null; twoFactorSecret: string | null };

const BI_MAT_RONG: BiMatNguoiDung = { passwordHash: null, twoFactorSecret: null };

/**
 * ★★★ Đọc bí mật của **một** tài khoản.
 *
 * ⚠⚠ `userId` nhận `null` **có chủ ý**, và đây không phải sự tiện tay: đường đăng nhập gọi hàm này
 *    **trước** khi biết tài khoản có tồn tại hay không (bản vá side-channel F9 —
 *    `_core/authService.ts` — bắt buộc `bcrypt.compare` chạy trên **mọi** nhánh). Nếu ta chỉ truy
 *    vấn khi người dùng CÓ THẬT thì lượt "không tồn tại" trả lời **nhanh hơn một lượt truy vấn**,
 *    và ta vừa dựng lại đúng cái side-channel vừa vá. Nên `null` vẫn **chạy một câu truy vấn hình
 *    dạng y hệt** (`userId = -1`, không khớp hàng nào).
 */
export async function layBiMatNguoiDung(userId: number | null): Promise<BiMatNguoiDung> {
  const db = await getDb();
  if (!db) return BI_MAT_RONG;
  const [row] = await db
    .select({ passwordHash: userSecrets.passwordHash, twoFactorSecret: userSecrets.twoFactorSecret })
    .from(userSecrets)
    .where(eq(userSecrets.userId, userId ?? -1))
    .limit(1);
  return row ?? BI_MAT_RONG;
}

/**
 * ★★★ Ghi bí mật của một tài khoản — **upsert**, vì `user_secrets` là 1:1 với `users` và hàng có
 * thể chưa tồn tại (tài khoản tạo bởi một build cũ, hoặc bởi `upsertUser` đường OAuth).
 *
 * ⚠ Chỉ ghi ô nào **được truyền vào**: `ghiBiMatNguoiDung(id, { twoFactorSecret: null })` phải
 *   **không** đụng tới `passwordHash`. Một `set` liệt kê cả hai ô sẽ **xoá mật khẩu** của người bật
 *   lại 2FA — im lặng, và không hoàn tác được.
 */
export async function ghiBiMatNguoiDung(
  userId: number,
  vaCham: Partial<BiMatNguoiDung>,
  tx?: any,
): Promise<void> {
  const db = tx ?? (await getDb());
  if (!db) throw new Error('Database not available');
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if ('passwordHash' in vaCham) set.passwordHash = vaCham.passwordHash ?? null;
  if ('twoFactorSecret' in vaCham) set.twoFactorSecret = vaCham.twoFactorSecret ?? null;
  await db
    .insert(userSecrets)
    .values({
      userId,
      passwordHash: 'passwordHash' in vaCham ? vaCham.passwordHash ?? null : null,
      twoFactorSecret: 'twoFactorSecret' in vaCham ? vaCham.twoFactorSecret ?? null : null,
    })
    .onConflictDoUpdate({ target: userSecrets.userId, set });
}

/**
 * ★★★ Pha 7 Task 9 (9b) — hai MỐC của lượt buộc đổi mật khẩu, đọc **MỚI TỪ DB**.
 *
 * ⚠⚠ **KHÔNG** suy ra từ `ctx.user`: hai cột ấy là `"server-only"` nên `redactServerOnlyUserFields`
 *    đã làm rỗng chúng ở đó ⇒ suy ra từ đó cho `false` **luôn luôn**, tức hỏng **im lặng theo
 *    chiều MỞ**. Xem `server/_core/publicUser.ts::suyRaPhaiDoiMatKhau`.
 */
export async function layMocMatKhau(userId: number): Promise<MocMatKhau> {
  const db = await getDb();
  if (!db) return { passwordChangedAt: null, passwordInvalidBefore: null };
  const [row] = await db
    .select({
      passwordChangedAt: users.passwordChangedAt,
      passwordInvalidBefore: users.passwordInvalidBefore,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? { passwordChangedAt: null, passwordInvalidBefore: null };
}

/** Vị từ *"tài khoản này phải đổi mật khẩu"* — đọc DB rồi hỏi **chủ duy nhất** của vị từ. */
export async function phaiDoiMatKhau(userId: number): Promise<boolean> {
  return suyRaPhaiDoiMatKhau(await layMocMatKhau(userId));
}

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

  // ★★★ Pha 7 Task 9 (9c) — **MỘT GIAO DỊCH.** Một hàng `users` KHÔNG có hàng `user_secrets` là
  // một tài khoản **không đăng nhập được**, và nó sẽ được tạo ra **im lặng** nếu hai câu `INSERT`
  // đứng rời nhau (§3.7(b) báo cáo Task 9 — ràng buộc, không phải gợi ý).
  const id = await db.transaction(async (tx) => {
    const [result] = await tx.insert(users).values({
      openId,
      username: data.username,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      department: data.department || null,
      position: data.position || null,
      loginMethod: 'local',
      role: data.role || 'user',
      isActive: true,
      // Mật khẩu vừa được đặt ⇒ mốc là BÂY GIỜ. Không có nó, một lượt thu hồi cũ sẽ buộc một tài
      // khoản **vừa tạo** phải đổi mật khẩu ngay.
      passwordChangedAt: new Date(),
    }).returning({ id: users.id });
    const uid = Number(result.id);
    await ghiBiMatNguoiDung(uid, { passwordHash: data.passwordHash }, tx);
    return uid;
  });
  return { id, openId };
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

/**
 * ★★★ Pha 7 Task 9 — lượt đổi mật khẩu ghi **HAI** chỗ, trong **MỘT giao dịch**:
 *   · `user_secrets.passwordHash` — bí mật mới;
 *   · `users.passwordChangedAt = now()` — thứ làm vị từ *"phải đổi mật khẩu"* **TỰ** thành false.
 * ⚠ Bỏ vế thứ hai ⇒ người dùng đổi mật khẩu xong **vẫn bị buộc đổi mãi mãi**. Bỏ vế thứ nhất ⇒
 *   mật khẩu không đổi. Tách chúng ra hai giao dịch ⇒ có một trạng thái trung gian nói dối.
 */
export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.transaction(async (tx) => {
    await ghiBiMatNguoiDung(userId, { passwordHash }, tx);
    await tx.update(users).set({ passwordChangedAt: new Date() }).where(eq(users.id, userId));
  });
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

  // ★★★ Pha 7 Task 9 (9c) — MỘT giao dịch (xem `createLocalUser`).
  return db.transaction(async (tx) => {
    const [result] = await tx.insert(users).values({
      openId,
      username: data.username || data.email.split('@')[0],
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      department: data.department || null,
      position: data.position || null,
      loginMethod: 'local',
      role: data.role || 'user',
      isActive: true,
      passwordChangedAt: new Date(),
    }).returning({ id: users.id });
    const uid = Number(result.id);
    await ghiBiMatNguoiDung(uid, { passwordHash }, tx);
    return uid;
  });
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
// ★★★ Pha 7 Task 9 (9c) — hạt giống TOTP nay ở `user_secrets`; `users.two_factor_enabled` (cờ
// CÔNG KHAI, không phải bí mật) ở lại `users`. Hai ô, hai bảng, đúng theo ngữ nghĩa.
export async function setup2FA(userId: number, secret: string) {
  await ghiBiMatNguoiDung(userId, { twoFactorSecret: secret });
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
  await db.transaction(async (tx) => {
    await ghiBiMatNguoiDung(userId, { twoFactorSecret: null }, tx);
    await tx.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, userId));
  });
  await invalidateAuthUser(userId);
}

/**
 * ★★★ **NGƯỜI ĐỌC DUY NHẤT** của cặp (cờ 2FA, hạt giống TOTP). Sau Task 9 hai ô ấy nằm ở **hai
 * bảng**, nên một `LEFT JOIN` — chứ không phải hai lượt gọi rời — giữ cho mọi người gọi thấy một
 * ảnh chụp **nhất quán** (trước Task 9 chúng ở cùng hàng nên tính chất này là miễn phí; nay nó
 * phải được viết ra).
 * ⚠ `LEFT` chứ không `INNER`: một tài khoản chưa có hàng `user_secrets` (tạo bởi build cũ) phải
 *   trả *"chưa bật 2FA"*, **không** phải biến mất khỏi kết quả.
 */
export async function get2FAStatus(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({
    twoFactorEnabled: users.twoFactorEnabled,
    twoFactorSecret: userSecrets.twoFactorSecret,
  })
    .from(users)
    .leftJoin(userSecrets, eq(userSecrets.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
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
/**
 * ★★★ Pha 8 Task 5 — **NGƯỜI DỌN DUY NHẤT của `backup_codes`.**
 *
 * ⚠⚠⚠ Vì sao phải là một hàm chứ không phải hai `db.delete(backupCodes)` viết tại chỗ: hai tuyến
 * SONG SONG tắt 2FA đã **bất đồng** đúng ở lượt dọn này —
 *   · `twoFactor.disable`  → `disable2FA()` **+ DELETE backup_codes`  ✅
 *   · `user.disable2FA`    → `disable2FA()` **và thôi**               ❌ 10 mã dự phòng SỐNG SÓT
 * Mã dự phòng là **vật liệu xác minh độc lập với hạt giống TOTP**: sau lượt tắt 2FA ở tuyến thứ
 * hai, chúng vẫn tiêu được ở `twoFactor.verify` và ở `POST /api/auth/verify-2fa` — tức một tờ giấy
 * mã dự phòng bị lộ **vẫn còn giá trị** dù người dùng tưởng đã tắt 2FA, và còn sống qua cả lượt
 * BẬT LẠI bằng một **hạt giống MỚI**.
 * ⇒ Một chủ, một luật. Bản sao thứ hai của một lượt dọn là chỗ luật trôi đi (bài học Pha 7 Task 8a).
 */
export async function xoaMoiMaDuPhong(userId: number, tx?: any) {
  const db = tx ?? (await getDb());
  if (!db) throw new Error("Database not available");
  await db.delete(backupCodes).where(eq(backupCodes.userId, userId));
}

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

  /**
   * ★★★★ Review TOÀN NHÁNH Pha 8 · **C-2 — CẮT TẠI NGUỒN, THEO TRẦN SUY RA TỪ SCHEMA.**
   *
   * `deviceName` (`varchar(255)`) được nạp thẳng từ header `User-Agent` — **dữ liệu KẺ TẤN CÔNG**.
   * Một UA 3.770 ký tự ⇒ `22001` ⇒ `ghiSoPhien` nuốt lỗi ⇒ lượt đăng nhập vẫn 200 nhưng **KHÔNG có
   * hàng sổ** ⇒ phiên ấy **vô hình** với `session.list` và **ngoài tầm** mọi đường thu hồi, tới 2027.
   *
   * ⚠ Đây là **NGƯỜI GHI DUY NHẤT** của `user_sessions` trong `server/**` (đo được, và có lượng từ
   *   canh: `server/_core/tranCotSoPhien.test.ts` §4). Cắt ở đây phủ mọi người gọi — kể cả lưới —
   *   mà không ai phải nhớ cắt.
   * ⚠ `sessionToken` là `text` ⇒ **KHÔNG** có trần ⇒ **KHÔNG** bị chạm. Cắt khoá phiên là đúc ra
   *   một hàng không bao giờ khớp cookie: cùng lỗ C-2, một đường im lặng hơn.
   */
  const [result] = await db
    .insert(userSessions)
    .values(catTheoTranCot(userSessions, data))
    .returning({ id: userSessions.id });
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

/**
 * ★★★ Pha 8 Task 2 — **THU HỒI ĐÚNG MỘT PHIÊN, THEO CHÍNH TOKEN CỦA NÓ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO HÀM NÀY PHẢI TỒN TẠI (đo được trên máy chủ sống, PID 25952, trước bản vá)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `auth.logout` chỉ **xoá cookie ở trình duyệt** + dọn cache. Nhưng cookie là **JWT phi trạng
 * thái**: kẻ đã bắt được nó không cần trình duyệt hợp tác. Đo trên `engineer1` (#51):
 *
 *     auth.logout ⇒ 200 · CÙNG cookie ⇒ auth.me trả **ĐỦ HỒ SƠ** · `user_sessions.isActive` = **t**
 *
 * Thứ duy nhất cưỡng chế được lượt thu hồi là hàng `user_sessions` — `sdk.xacThucTho` đọc nó mỗi
 * lượt (`getSessionByToken` ⇒ `isActive === false` ⇒ `ForbiddenError`). Không lật ô ấy thì
 * *"đăng xuất"* là **lời hứa suông** cho tới `expiresAt` (đo được: **2027-08-09**).
 *
 * ⚠⚠ **KHÔNG dùng `revokeSession(id, userId)` cho đường này**, dù trông giống: `auth.logout` là
 *    thủ tục **`public`** — `ctx.user` có thể `null` (phiên đã hết hạn phía trên, hoặc cờ buộc đổi
 *    mật khẩu đang chặn) trong khi `ctx.sessionToken` vẫn có. Đòi `userId` ở đây là tự dựng một
 *    nhánh im lặng **không thu hồi gì cả** đúng vào lúc cần thu hồi nhất.
 *
 * ⚠ Lượt dọn cache nằm **TRONG** hàm này, đúng như `revokeSession` / `revokeAllSessions` ở dưới:
 *   một bất biến (*"phiên bị thu hồi ⇒ cache của nó biến mất"*) có **ĐÚNG MỘT CHỦ**. Để người gọi
 *   tự nhớ gọi thêm là dựng người ghi **thứ hai** dưới cùng một bất biến — lớp lỗi đã đẻ **ba**
 *   Critical trong chuỗi pha này.
 * ⚠ Và nó **KHÔNG** phụ thuộc lượt ghi sổ có khớp hàng nào không: phiên cũ (đăng nhập trước khi
 *   `user_sessions` ra đời) không có hàng, nhưng **vẫn có thể đang nằm trong cache**.
 *
 * @returns số hàng thật sự bị lật — người gọi **không** cần dùng; có để phép đo không phải suy ra.
 */
export async function thuHoiPhienTheoToken(sessionToken: string): Promise<number> {
  let daThuHoi = 0;
  const db = await getDb();
  if (db) {
    const hang = await db.update(userSessions)
      .set({ isActive: false })
      .where(eq(userSessions.sessionToken, sessionToken))
      .returning({ id: userSessions.id });
    daThuHoi = hang.length;
  }
  await invalidateAuthSession(sessionToken);
  return daThuHoi;
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
