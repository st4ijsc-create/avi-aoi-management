/**
 * Lô 6 Mục 1 (BG-132) — `requireAnyPermission`: middleware DÙNG CHUNG cho một tài nguyên
 * có NHIỀU vai hợp lệ (OR nhiều cặp module/action), sinh khi chủ dự án chốt ruling (A) cho
 * đường GHI bố cục ở server (xem `docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md`
 * BG-132): gate mới của layoutRouters = `analytics_oee` HOẶC `settings_factory`, KHÔNG được để
 * người dùng `settings_factory` cũ mất quyền (chống hồi quy).
 *
 * `requirePermission` (accessControl.ts:241) hiện chỉ nhận MỘT cặp {module, action}. Middleware
 * này thêm khả năng OR nhiều cặp mà giữ CÙNG hình dạng lỗi (`appError('FORBIDDEN',
 * 'PERMISSION_DENIED', { action }, fallbackMessage)`) để không phá `readAppErrorMeta`/từ điển
 * i18n `errors.action.*` phía client — chỉ thêm middleware mới, không đổi `requirePermission`.
 *
 * ĐO BẰNG DB THẬT, USER role:'operator' (KHÔNG-ADMIN) — `checkPermission` (accessControl.ts:205-207)
 * cho admin bypass (`isAdmin && !scopedAdminEnabled() → true`) TRƯỚC KHI đọc bảng `permissions`;
 * đo bằng admin chứng minh 0 về quyền (bài học Lô 5 Mục 1 / BG-127). File này seed bảng
 * `permissions` thật cho user `operator`, gọi middleware qua một router test tối giản
 * (`createCaller`), không mock `accessControl`/`../db`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTRPC } from "@trpc/server";
import { inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { users, permissions } from "../../drizzle/schema";
import { requireAnyPermission } from "./accessControl";
import { readAppErrorMeta } from "./appError";
import type { TrpcContext } from "./context";

const DB_URL = process.env.DATABASE_URL;
const TAG = `L6M1_${Date.now().toString(36).toUpperCase()}`;

// Router test tối giản — KHÔNG tái dùng trpc.ts thật (tránh kéo theo mọi middleware phiên/CSRF
// không liên quan tới phép đo này); chỉ cần .use() nhận đúng { ctx, next } như trpc.ts thật.
const t = initTRPC.context<TrpcContext>().create();
const testRouter = t.router({
  needsEither: t.procedure
    .use(requireAnyPermission([
      { module: "analytics_oee", action: "canEdit" },
      { module: "settings_factory", action: "canEdit" },
    ]))
    .mutation(() => ({ ok: true })),
});

function ctxFor(userId: number, role: string): TrpcContext {
  return {
    user: { id: userId, role, name: `${TAG}-${userId}` } as TrpcContext["user"],
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = (userId: number, role = "operator") => testRouter.createCaller(ctxFor(userId, role));

let coDb = false;
let idChiThuNhat = 0; // operator, CHỈ analytics_oee.canEdit=true
let idChiThuHai = 0; // operator, CHỈ settings_factory.canEdit=true
let idKhongGi = 0; // operator, không có hàng permissions nào
let idAdmin = 0; // admin thật (role:'admin'), KHÔNG seed permissions — đo bypass sẵn có

async function mkUser(tag: string, role: string): Promise<number> {
  const db = await getDb();
  const [u] = await db!
    .insert(users)
    .values({
      openId: `${TAG}_${tag}`,
      username: `${TAG}_${tag}`,
      name: `Lo6 Muc1 ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function grant(userId: number, moduleName: string, category: string) {
  const db = await getDb();
  await db!.insert(permissions).values({
    userId,
    category,
    moduleName,
    canView: true,
    canCreate: false,
    canEdit: true,
    canDelete: false,
    canExport: false,
  });
}

describe.skipIf(!DB_URL)("Lô 6 Mục 1 — requireAnyPermission (BG-132), DB thật, non-admin", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) return;
    coDb = true;
    idChiThuNhat = await mkUser("chi-thu-nhat", "operator");
    idChiThuHai = await mkUser("chi-thu-hai", "operator");
    idKhongGi = await mkUser("khong-gi", "operator");
    idAdmin = await mkUser("admin-that", "admin");
    await grant(idChiThuNhat, "analytics_oee", "analytics");
    await grant(idChiThuHai, "settings_factory", "settings");
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    const ids = [idChiThuNhat, idChiThuHai, idKhongGi, idAdmin].filter((x) => x > 0);
    if (ids.length > 0) {
      await db.delete(permissions).where(inArray(permissions.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  });

  it("user chỉ có QUYỀN THỨ NHẤT (analytics_oee) ⇒ QUA", async () => {
    if (!coDb) return;
    await expect(caller(idChiThuNhat).needsEither()).resolves.toEqual({ ok: true });
  });

  it("user chỉ có QUYỀN THỨ HAI (settings_factory) ⇒ QUA", async () => {
    if (!coDb) return;
    await expect(caller(idChiThuHai).needsEither()).resolves.toEqual({ ok: true });
  });

  it("user KHÔNG có quyền nào ⇒ FORBIDDEN, cùng hình dạng appError với requirePermission", async () => {
    if (!coDb) return;
    await expect(caller(idKhongGi).needsEither()).rejects.toThrow(/FORBIDDEN|PERMISSION_DENIED|quyền/i);
    try {
      await caller(idKhongGi).needsEither();
      throw new Error("phải ném lỗi — không được tới đây");
    } catch (err) {
      const meta = readAppErrorMeta(err);
      expect(meta?.appCode).toBe("PERMISSION_DENIED");
      // action = action của yêu cầu ĐẦU TIÊN trong danh sách — giữ tương thích từ điển i18n.
      expect(meta?.appParams).toEqual({ action: "canEdit" });
    }
  });

  it("admin (role:'admin', KHÔNG seed permissions) ⇒ QUA — bypass sẵn có của checkPermission", async () => {
    if (!coDb) return;
    await expect(caller(idAdmin, "admin").needsEither()).resolves.toEqual({ ok: true });
  });
});
