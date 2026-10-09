/**
 * doc 81 Đợt 4 Task A3 — bốn thủ tục ĐỌC nhà máy của `twin.*` (sceneGraph · twinModels · replay · occupancyGrid)
 * nay cùng cổng phạm vi với `usdExport` (Đợt 42). CSDL THẬT `_test`, `appRouter.createCaller` THẬT.
 *
 * Trước: cổng duy nhất là RBAC `machine_monitoring` ⇒ người gán nhà máy A đọc được cảnh/mô hình/lưới/replay của B
 * chỉ bằng cách đổi `factoryId`. Nay: ngoài phạm vi ⇒ NOT_FOUND / ENTITY_NOT_FOUND / "Factory <id> not found" —
 * GIỐNG HỆT nhà máy không tồn tại (G82: không một mã riêng nào xác nhận nhà máy kia có thật).
 * Người thử: (A) gán ĐÚNG nhà máy A, đủ quyền RBAC; (0) đủ quyền, 0 gán; admin (bypass). Thứ DUY NHẤT khác giữa (A)
 * và (0) là bản gán nhà máy (G43).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { appRouter } from "../routers";
import { resolvePermissionModule } from "@shared/permissions";

const DB_URL = process.env.DATABASE_URL;
const DAU = `D4A3-${Date.now()}`;
const KHONG_TON_TAI = 2_000_000_000;

let sql: ReturnType<typeof postgres>;
const fx = { a: 0, b: 0, aCode: "", bCode: "", userA: 0, user0: 0, extra: [] as Array<{ table: string; id: number }> };

type Caller = ReturnType<typeof appRouter.createCaller>;
const goi = (id: number, role = "engineer"): Caller => appRouter.createCaller({ user: { id, role, name: "probe" } } as never);

type KetQua = { ok: true; data: unknown } | { ok: false; code: string; appCode: string | null; msg: string };
async function thu(p: Promise<unknown>): Promise<KetQua> {
  try {
    return { ok: true, data: await p };
  } catch (e: unknown) {
    const err = e as { code?: string; cause?: { appCode?: string }; message?: string };
    return { ok: false, code: err?.code ?? "?", appCode: err?.cause?.appCode ?? null, msg: String(err?.message ?? "") };
  }
}

const THU_TUC: Array<{ ten: string; goi: (c: Caller, factoryId: number) => Promise<unknown> }> = [
  { ten: "sceneGraph", goi: (c, f) => c.twin.sceneGraph({ factoryId: f }) },
  { ten: "twinModels", goi: (c, f) => c.twin.twinModels({ factoryId: f }) },
  { ten: "usdExport", goi: (c, f) => c.twin.usdExport({ factoryId: f }) },
  {
    ten: "replay",
    goi: (c, f) => c.twin.replay({ factoryId: f, from: new Date(Date.now() - 120_000), to: new Date(Date.now() - 60_000), step: 30 }),
  },
  { ten: "occupancyGrid", goi: (c, f) => c.twin.occupancyGrid({ factoryId: f }) },
];

/** The not-found shape, with the requested id written in — identical for "missing" and "out of scope". */
const notFound = (k: KetQua, factoryId: number) =>
  !k.ok && k.code === "NOT_FOUND" && k.appCode === "ENTITY_NOT_FOUND" && k.msg === `Factory ${factoryId} not found`;

describe.skipIf(!DB_URL)("doc 81 Đợt 4 Task A3 — twin.* đọc nhà máy theo phạm vi (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    fx.aCode = `${DAU}-A`;
    fx.bCode = `${DAU}-B`;
    fx.a = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${fx.aCode}, 'A3 A', true) RETURNING id`);
    fx.b = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${fx.bCode}, 'A3 B', true) RETURNING id`);
    const user = (tag: string) =>
      one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}`}, ${`${DAU} ${tag}`}, 'engineer', true) RETURNING id`);
    fx.userA = await user("a");
    fx.user0 = await user("0");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${fx.userA}, ${fx.aCode})`;
    for (const u of [fx.userA, fx.user0]) {
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView")
                VALUES (${u}, 'machine_monitoring', ${resolvePermissionModule("machine_monitoring")}, true)`;
    }
  });

  afterAll(async () => {
    if (!sql) return;
    const uids = [fx.userA, fx.user0].filter(Boolean);
    if (uids.length) {
      await sql`DELETE FROM permissions WHERE "userId" IN ${sql(uids)}`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(uids)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(uids)}`;
    }
    const fids = [fx.a, fx.b].filter(Boolean);
    if (fids.length) await sql`DELETE FROM factories WHERE id IN ${sql(fids)}`;
    await sql.end();
  });

  it("đối chứng danh tính: người A gán ĐÚNG nhà máy A, người 0 không gán gì", async () => {
    const g = await sql`SELECT "userId", "factoryCode" FROM user_factory_assignments WHERE "userId" IN ${sql([fx.userA, fx.user0])}`;
    expect(g.map((r) => [Number(r.userId), r.factoryCode])).toEqual([[fx.userA, fx.aCode]]);
  });

  for (const tt of THU_TUC) {
    it(`★ ${tt.ten}: người A hỏi B ⇒ GIỐNG HỆT nhà máy không tồn tại (NOT_FOUND / ENTITY_NOT_FOUND / "Factory <id> not found")`, async () => {
      const b = await thu(tt.goi(goi(fx.userA), fx.b));
      const missing = await thu(tt.goi(goi(fx.userA), KHONG_TON_TAI));
      expect(notFound(b, fx.b), JSON.stringify(b)).toBe(true);
      expect(notFound(missing, KHONG_TON_TAI), JSON.stringify(missing)).toBe(true);
      // same shape with the id substituted — no field tells "exists" from "out of scope"
      const norm = (k: KetQua, id: number) => JSON.stringify(k).split(String(id)).join("<id>");
      expect(norm(b, fx.b)).toBe(norm(missing, KHONG_TON_TAI));
      expect(JSON.stringify(b)).not.toContain(fx.bCode);
    });

    it(`★ ${tt.ten}: người 0 gán hỏi A ⇒ NOT_FOUND; người A hỏi A ⇒ trả lời; admin hỏi B ⇒ trả lời`, async () => {
      expect(notFound(await thu(tt.goi(goi(fx.user0), fx.a)), fx.a)).toBe(true);
      const own = await thu(tt.goi(goi(fx.userA), fx.a));
      expect(own.ok, JSON.stringify(own)).toBe(true);
      const admin = await thu(tt.goi(goi(954_903, "admin"), fx.b));
      expect(admin.ok, JSON.stringify(admin)).toBe(true);
    });
  }

  it("sceneGraph: người A hỏi A thấy ĐÚNG nhà máy A (đối chứng dương trên dữ liệu, không chỉ 'không ném')", async () => {
    const g = (await goi(fx.userA).twin.sceneGraph({ factoryId: fx.a })) as { factory: { code?: string } | null };
    expect(JSON.stringify(g.factory)).toContain(fx.aCode);
    const ad = (await goi(954_903, "admin").twin.sceneGraph({ factoryId: fx.b })) as { factory: unknown };
    expect(JSON.stringify(ad.factory)).toContain(fx.bCode);
  });
});
