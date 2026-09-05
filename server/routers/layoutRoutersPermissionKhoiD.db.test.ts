/**
 * Lô 5 Mục 1 — ĐO cổng `analytics_oee` cho vai KHÔNG-admin (nợ đo Khối D, -46 chưa làm).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI ĐO BẰNG USER KHÔNG-ADMIN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `checkPermission` (server/_core/accessControl.ts:205-207): `if (isAdmin && !scopedAdminEnabled())
 * return true` — admin BYPASS mọi `requirePermission`, không đọc bảng `permissions`. Mọi phép đo
 * quyền chạy bằng `role: "admin"` (như `layoutRoutersAuditKhoiD.db.test.ts` — tự khai ở dòng 48-49
 * của chính nó) chứng minh ĐÚNG 0 VỀ QUYỀN — admin luôn qua bất kể gate là gì. Lưới này dùng
 * `role: "operator"` (không-admin, theo mẫu `aoiPackageDeadCongDanHangNhat.test.ts`/Lô 4 và
 * `aiCodingSessionScope.test.ts` — seed bảng `permissions` thật) làm biến số duy nhất.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐO ĐƯỢC GÌ (đọc code TRƯỚC, không suy đoán)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * · `layoutRouter.listByWorkshop` / `getById` (server/routers/layoutRouters.ts:36-52): CẢ HAI là
 *   `protectedProcedure` TRẦN — KHÔNG `.use(requirePermission(...))` nào. Bất kỳ user đăng nhập
 *   nào (bất kể permission) đều đọc được — đây là hành vi CÓ TỪ TRƯỚC Khối D, không phải hệ quả
 *   ruling (A); ghi lại làm phép đo, KHÔNG "vá" (ngoài phạm vi Mục 1 — brief chỉ xin ĐO).
 * · `layoutRouter.create/update/delete/addMachinePosition/updateMachinePosition/removeMachinePosition`
 *   đều `.use(requirePermission("settings_factory", <action>))` — KHÔNG PHẢI `analytics_oee`.
 *   ⇒ Theo đúng nhánh "DỪNG" của brief: ruling (A) (hub một cổng `analytics_oee`, kể cả cho
 *   đường ghi bố cục) CHƯA được cài ở SERVER cho các mutation. Đây là LỆCH giữa client-route
 *   (hub `/digital-twin` gate `analytics_oee`) và server-gate (mutation vẫn `settings_factory`).
 *   Lưới dưới đây CHỈ ĐO — không đổi gate (đó là quyết định phân quyền, ngoài phạm vi mục này).
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
    await db!.insert(permissions).values({
      userId: u!.id,
      category: "analytics",
      moduleName: "analytics_oee",
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
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

  describe("Ghi (create) — ĐO GATE THẬT: settings_factory, KHÔNG PHẢI analytics_oee", () => {
    it("ÂM — user CÓ analytics_oee nhưng KHÔNG có settings_factory BỊ CHẶN ở create (FORBIDDEN)", async () => {
      if (!coDb) return;
      await expect(
        caller(idCoAnalyticsOee).create({ workshopId: 777702, name: `${TAG}-should-fail` }),
      ).rejects.toThrow(/FORBIDDEN|PERMISSION_DENIED|quyền/i);
    });

    it("ÂM — user KHÔNG có bất kỳ quyền nào BỊ CHẶN ở create (FORBIDDEN)", async () => {
      if (!coDb) return;
      await expect(
        caller(idKhongCoGi).create({ workshopId: 777702, name: `${TAG}-should-fail-2` }),
      ).rejects.toThrow(/FORBIDDEN|PERMISSION_DENIED|quyền/i);
    });

    it("DƯƠNG — user CÓ settings_factory (không cần analytics_oee) TẠO ĐƯỢC layout — xác nhận gate thật vẫn là settings_factory", async () => {
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

  // KẾT LUẬN ĐO (ghi vào báo cáo, KHÔNG tự sửa — quyết định phân quyền ngoài phạm vi Mục 1):
  // Ruling (A) "hub một cổng analytics_oee" áp dụng cho ĐƯỜNG ĐỌC ở client (RouteGuard của
  // /digital-twin) nhưng KHÔNG áp dụng cho ĐƯỜNG GHI ở server (layoutRouter mutations vẫn
  // settings_factory, không đổi qua Khối D). Đây là DỮ KIỆN được đo, không phải lỗi cần vá ở
  // Mục 1 — mục này chỉ ĐO và báo lệch (xem lo-5-report.md).
});
