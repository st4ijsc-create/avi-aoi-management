/**
 * BG-131 (Lô 9 Mục 3) — đo BẰNG DB THẬT cổng `admin_system` mới của `integrityRouter`
 * (summary/runNow/history đổi từ `adminProcedure` sang
 * `protectedProcedure + requirePermission("admin_system", ...)`, xem docblock đầu
 * `integrityRouter.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI ĐO BẰNG USER KHÔNG-ADMIN (GOTCHA đã trả giá nhiều lô trước)
 * ══════════════════════════════════════════════════════════════════════════════════
 * `checkPermission` (`server/_core/accessControl.ts:205-207`): `if (isAdmin &&
 * !scopedAdminEnabled()) return true` — admin BYPASS mọi `requirePermission`, không
 * đọc bảng `permissions`. Đo bằng `role: "admin"` chứng minh ĐÚNG 0 về quyền (admin
 * luôn qua bất kể gate là gì). Lưới này seed bảng `permissions` THẬT cho user
 * `role: "operator"` (mẫu `layoutRoutersPermissionKhoiD.db.test.ts`/
 * `aoiPackageDeadCongDanHangNhat.test.ts`) — không mock `../db` hay `accessControl`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * 4 CA (đúng brief Lô 9 Mục 3 khoản 3)
 * ══════════════════════════════════════════════════════════════════════════════════
 *   1. operator KHÔNG có hàng `permissions.admin_system` nào ⇒ FORBIDDEN cả
 *      summary LẪN runNow (0 quyền = 0 việc, kể cả đọc).
 *   2. operator CÓ `admin_system.canView=true` (canEdit=false) ⇒ summary OK, runNow
 *      FORBIDDEN (đọc ≠ ghi — canView không tự động cho canEdit).
 *   3. Cùng user, THÊM `canEdit=true` (update hàng permissions) ⇒ runNow OK.
 *   4. role='admin' (KHÔNG seed hàng permissions nào) ⇒ OK cả hai — chứng minh admin
 *      KHÔNG mất quyền qua bản vá này (giữ bypass, đúng lời hứa "không ai mất quyền"
 *      trong docblock `integrityRouter.ts`).
 *
 * `getConstraintStates()`/`getIntegrityScanSchedulerStatus()`/`runIntegrityScanNow()`
 * tự chịu được DB test rỗng (integrity_scan_results có thể chưa có snapshot nào) —
 * `summary` fail-safe (try/catch quanh truy vấn snapshot), không throw ngoài ý muốn.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { users, permissions } from "../../drizzle/schema";
import { integrityRouter } from "./integrityRouter";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const TAG = `L9M3_${Date.now().toString(36).toUpperCase()}`;

let coDb = false;
let idKhongCoGi = 0; // operator, 0 hàng permissions
let idCoView = 0; // operator, admin_system.canView=true canEdit=false (nâng canEdit=true ở ca 3)
let idAdmin = 0; // role='admin', 0 hàng permissions — đo bypass

function ctxFor(userId: number, role: string): TrpcContext {
  return {
    user: { id: userId, role, name: `${TAG}-${userId}` } as TrpcContext["user"],
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = (userId: number, role = "operator") => integrityRouter.createCaller(ctxFor(userId, role));

async function mkOperator(tag: string): Promise<number> {
  const db = await getDb();
  const [u] = await db!
    .insert(users)
    .values({
      openId: `${TAG}_${tag}`,
      username: `${TAG}_${tag}`,
      name: `Lo9 Muc3 ${tag}`,
      role: "operator",
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u!.id;
}

describe.skipIf(!DB_URL)("BG-131 — integrityRouter đo cổng admin_system bằng user KHÔNG-admin", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) return;
    coDb = true;
    idKhongCoGi = await mkOperator("khong-gi");
    idCoView = await mkOperator("co-view");
    await db.insert(permissions).values({
      userId: idCoView,
      category: "admin",
      moduleName: "admin_system",
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
    });
    const [admin] = await db
      .insert(users)
      .values({
        openId: `${TAG}_admin`,
        username: `${TAG}_admin`,
        name: `Lo9 Muc3 admin`,
        role: "admin",
        loginMethod: "local",
      })
      .returning({ id: users.id });
    idAdmin = admin!.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    const ids = [idKhongCoGi, idCoView, idAdmin].filter((x) => x > 0);
    if (ids.length > 0) {
      await db.delete(permissions).where(inArray(permissions.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  });

  it("★ ca 1 — operator KHÔNG có admin_system: FORBIDDEN cả summary lẫn runNow", async () => {
    if (!coDb) return;
    await expect(caller(idKhongCoGi).summary()).rejects.toThrow(/FORBIDDEN|PERMISSION_DENIED|quyền/i);
    await expect(caller(idKhongCoGi).runNow()).rejects.toThrow(/FORBIDDEN|PERMISSION_DENIED|quyền/i);
  });

  it("★ ca 2 — operator CÓ admin_system.canView (canEdit=false): summary OK, runNow FORBIDDEN", async () => {
    if (!coDb) return;
    await expect(caller(idCoView).summary()).resolves.toBeDefined();
    await expect(caller(idCoView).runNow()).rejects.toThrow(/FORBIDDEN|PERMISSION_DENIED|quyền/i);
  });

  it("★ ca 3 — CÙNG user, THÊM canEdit=true: runNow nay OK", async () => {
    if (!coDb) return;
    const db = await getDb();
    await db!
      .update(permissions)
      .set({ canEdit: true })
      .where(inArray(permissions.userId, [idCoView]));
    await expect(caller(idCoView).runNow()).resolves.toBeDefined();
    // summary vẫn OK (không hồi quy đường đọc khi thêm quyền ghi).
    await expect(caller(idCoView).summary()).resolves.toBeDefined();
  });

  it("★ ca 4 — role='admin' (0 hàng permissions): OK cả hai — KHÔNG MẤT quyền qua bản vá", async () => {
    if (!coDb) return;
    await expect(caller(idAdmin, "admin").summary()).resolves.toBeDefined();
    await expect(caller(idAdmin, "admin").runNow()).resolves.toBeDefined();
  });

  it("history — CÙNG cổng canView (đọc) như summary, không phải cổng riêng", async () => {
    if (!coDb) return;
    await expect(
      caller(idKhongCoGi).history({ key: "fk:x->y" }),
    ).rejects.toThrow(/FORBIDDEN|PERMISSION_DENIED|quyền/i);
    await expect(caller(idCoView).history({ key: "fk:x->y" })).resolves.toBeDefined();
  });
});
