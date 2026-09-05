/**
 * Lô 5 Mục 1 — ĐO cổng `analytics_oee` cho vai KHÔNG-admin (nợ đo Khối D, -46 chưa làm).
 * Lô 6 Mục 2 (BG-132) — chủ dự án chốt ruling (A) CHO CẢ đường ghi: gate mới =
 * `analytics_oee` HOẶC `settings_factory` (`requireAnyPermission`, `layoutRouters.ts`). Ca
 * "user chỉ có `analytics_oee` bị FORBIDDEN ở create" LẬT thành "được phép" (hành vi mới ĐÚNG),
 * GIỮ ca không-quyền-nào bị chặn, THÊM ca chỉ-`settings_factory` vẫn qua (chống hồi quy — người
 * dùng cũ không được mất quyền).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI ĐO BẰNG USER KHÔNG-ADMIN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `checkPermission` (server/_core/accessControl.ts:205-207): `if (isAdmin && !scopedAdminEnabled())
 * return true` — admin BYPASS mọi `requirePermission`/`requireAnyPermission`, không đọc bảng
 * `permissions`. Mọi phép đo quyền chạy bằng `role: "admin"` (như
 * `layoutRoutersAuditKhoiD.db.test.ts` — tự khai ở dòng 48-49 của chính nó) chứng minh ĐÚNG 0 VỀ
 * QUYỀN — admin luôn qua bất kể gate là gì. Lưới này dùng `role: "operator"` (không-admin, theo
 * mẫu `aoiPackageDeadCongDanHangNhat.test.ts`/Lô 4 và `aiCodingSessionScope.test.ts` — seed bảng
 * `permissions` thật) làm biến số duy nhất.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐO ĐƯỢC GÌ (đọc code TRƯỚC, không suy đoán)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * · `layoutRouter.listByWorkshop` / `getById` (server/routers/layoutRouters.ts): CẢ HAI là
 *   `protectedProcedure` TRẦN — KHÔNG `.use(...)` nào. Bất kỳ user đăng nhập nào (bất kể
 *   permission) đều đọc được — đây là hành vi CÓ TỪ TRƯỚC Khối D, KHÔNG đổi ở Lô 6 (brief chỉ
 *   xin đổi đường GHI).
 * · `layoutRouter.create/update/delete/addMachinePosition/updateMachinePosition/removeMachinePosition`
 *   (6 mutation) nay `.use(requireAnyPermission([{analytics_oee,<action>},{settings_factory,<action>}]))`
 *   — OR hai quyền, dạng "một trong hai đều qua", KHÔNG PHẢI chỉ `settings_factory` như trước
 *   Lô 6. Đây là bản vá ĐÓNG lệch mà Lô 5 Mục 1 đo được (BG-132).
 *
 * DB THẬT — không mock `../db` hay `accessControl` (giống các lưới permission khác trong repo):
 * `checkPermission` tự query bảng `permissions` qua `getDb()`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { users, permissions, factoryLayouts } from "../../drizzle/schema";
import { layoutRouter } from "./layoutRouters";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const TAG = `L5M1_${Date.now().toString(36).toUpperCase()}`;

let coDb = false;
let idCoAnalyticsOee = 0; // operator, permissions.analytics_oee.canView = true, KHÔNG có settings_factory
let idKhongCoGi = 0; // operator, không có bất kỳ hàng permissions nào
const layoutIdsToClean: number[] = [];

function ctxFor(userId: number, role: string): TrpcContext {
  return {
    user: { id: userId, role, name: `${TAG}-${userId}` } as TrpcContext["user"],
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = (userId: number, role = "operator") => layoutRouter.createCaller(ctxFor(userId, role));

async function mkUser(tag: string, capAnalyticsOee: boolean): Promise<number> {
  const db = await getDb();
  const [u] = await db!
    .insert(users)
    .values({
      openId: `${TAG}_${tag}`,
      username: `${TAG}_${tag}`,
      name: `Lo5 Muc1 ${tag}`,
      role: "operator",
      loginMethod: "local",
    })
    .returning({ id: users.id });
  if (capAnalyticsOee) {
    // Lô 6 Mục 2 (BG-132) — trước chỉ cần canView (đo đường ĐỌC, không gate). Nay gate GHI mới
    // (`requireAnyPermission`) hỏi canCreate/canEdit/canDelete của CHÍNH module này ⇒ seed đủ ba
    // để ca "LẬT" (create) đo đúng nhánh analytics_oee của OR, không lẫn với settings_factory.
    await db!.insert(permissions).values({
      userId: u!.id,
      category: "analytics",
      moduleName: "analytics_oee",
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canExport: false,
    });
  }
  return u!.id;
}

describe.skipIf(!DB_URL)("Lô 5 Mục 1 — cổng analytics_oee đo bằng user KHÔNG-admin (layoutRouter)", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) return;
    coDb = true;
    idCoAnalyticsOee = await mkUser("co-oee", true);
    idKhongCoGi = await mkUser("khong-gi", false);
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    if (layoutIdsToClean.length > 0) {
      await db.delete(factoryLayouts).where(inArray(factoryLayouts.id, layoutIdsToClean));
    }
    const ids = [idCoAnalyticsOee, idKhongCoGi].filter((x) => x > 0);
    if (ids.length > 0) {
      await db.delete(permissions).where(inArray(permissions.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  });

  describe("Đọc (listByWorkshop/getById) — ĐO: protectedProcedure trần, không gate quyền nào", () => {
    it("★ user KHÔNG có analytics_oee (và không có settings_factory) VẪN đọc được listByWorkshop — không có gate", async () => {
      if (!coDb) return;
      // Không throw ⇒ đo được: đọc bố cục không đòi bất kỳ permission nào (kể cả trước Khối D).
      await expect(caller(idKhongCoGi).listByWorkshop({ workshopId: 777701 })).resolves.toBeDefined();
    });

    it("user CÓ analytics_oee đọc được listByWorkshop (nhất quán — không có gate nên luôn qua)", async () => {
      if (!coDb) return;
      await expect(caller(idCoAnalyticsOee).listByWorkshop({ workshopId: 777701 })).resolves.toBeDefined();
    });
  });

  describe("Ghi (create) — GATE MỚI (BG-132, Lô 6): analytics_oee HOẶC settings_factory", () => {
    // LẬT (Lô 6 Mục 2): trước đây user CHỈ có analytics_oee bị FORBIDDEN — nay ruling (A) chốt
    // OR hai quyền cho đường ghi ⇒ hành vi ĐÚNG là ĐƯỢC PHÉP. RED xác nhận bằng git history:
    // `git show HEAD~1:server/routers/layoutRoutersPermissionKhoiD.db.test.ts` (trước Lô 6 Mục 2)
    // mang ca `.rejects.toThrow(...)` cho đúng lời gọi này — ca đó đỏ ngay khi đổi kỳ vọng nếu
    // chạy trên router CŨ (`requirePermission(MODULE, ...)` chỉ settings_factory).
    it("★ LẬT — user CÓ analytics_oee (KHÔNG có settings_factory) NAY ĐƯỢC PHÉP tạo layout (ruling A + OR)", async () => {
      if (!coDb) return;
      const res = await caller(idCoAnalyticsOee).create({ workshopId: 777702, name: `${TAG}-oee-ok` });
      layoutIdsToClean.push(res.id);
      expect(res.id).toBeGreaterThan(0);
    });

    it("GIỮ — user KHÔNG có bất kỳ quyền nào (cả hai phía) BỊ CHẶN ở create (FORBIDDEN)", async () => {
      if (!coDb) return;
      await expect(
        caller(idKhongCoGi).create({ workshopId: 777702, name: `${TAG}-should-fail-2` }),
      ).rejects.toThrow(/FORBIDDEN|PERMISSION_DENIED|quyền/i);
    });

    it("THÊM — CHỐNG HỒI QUY: user CHỈ có settings_factory (không có analytics_oee) VẪN tạo được layout", async () => {
      if (!coDb) return;
      const db = await getDb();
      const idCoSettingsFactory = await (async () => {
        const [u] = await db!
          .insert(users)
          .values({
            openId: `${TAG}_co-settings`,
            username: `${TAG}_co-settings`,
            name: `Lo5 Muc1 co-settings`,
            role: "operator",
            loginMethod: "local",
          })
          .returning({ id: users.id });
        await db!.insert(permissions).values({
          userId: u!.id,
          category: "settings",
          moduleName: "settings_factory",
          canView: true,
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canExport: false,
        });
        return u!.id;
      })();
      try {
        const res = await caller(idCoSettingsFactory).create({ workshopId: 777702, name: `${TAG}-ok` });
        layoutIdsToClean.push(res.id);
        expect(res.id).toBeGreaterThan(0);
      } finally {
        await db!.delete(permissions).where(eq(permissions.userId, idCoSettingsFactory));
        await db!.delete(users).where(eq(users.id, idCoSettingsFactory));
      }
    });
  });

  // KẾT LUẬN (Lô 6 Mục 2, BG-132 ĐÓNG): ruling (A) "hub một cổng analytics_oee" nay áp dụng cho
  // CẢ đường đọc client (RouteGuard /digital-twin, có từ Khối D) LẪN đường ghi server
  // (layoutRouter 6 mutation, `requireAnyPermission` OR analytics_oee|settings_factory). Rủi ro
  // đã nhận: người có analytics_oee (không có settings_factory) nay sửa được bố cục xưởng — chủ
  // dự án chấp nhận rủi ro này khi chốt ruling (A) 2026-09-05 (xem lo-6-report.md).
});
