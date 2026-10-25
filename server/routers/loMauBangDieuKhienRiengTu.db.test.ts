/**
 * CỔNG CSDL THẬT — lô L6t (rà bảo mật tRPC, 2026-10-25): mẫu bảng điều khiển RIÊNG của người khác bị đọc / áp theo id — dashboardWidget.getSharedTemplateById · dashboard.getTemplate · dashboard.applyTemplate.
 * Luật (dieu-phoi): chỉ CHỦ mẫu hoặc mẫu công khai (isPublic) được đọc / áp; mẫu riêng của người khác ≡ không tồn tại (trả null như mẫu không có thật, KHÔNG tăng bộ đếm sử dụng); admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { qChuTest } from "../testing/__haiNhaMayDoLuong";

const RUN = `l6t${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
type C = { w: any; d: any };
let cA: C, cB: C, cAdm: C;
let uA = 0, uB = 0;
const ids: Record<string, number> = {};
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  return {
    w: (await import("./dashboardWidgetRouters")).dashboardWidgetRouter.createCaller(ctx),
    d: (await import("./dashboardStatsRouters")).dashboardRouter.createCaller(ctx),
  };
};
const dem = async (id: number) => Number((await dung(sql`SELECT "usageCount" AS n FROM dashboard_templates WHERE id = ${id}`))[0].n ?? 0);

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const a = await taoNguoiDungTest("a", "supervisor", { tienTo: "l6t", ts: RUN, ten: "l6t a" });
  const b = await taoNguoiDungTest("b", "supervisor", { tienTo: "l6t", ts: RUN, ten: "l6t b" });
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "l6t", ts: RUN, ten: "l6t ad" });
  uA = a.id; uB = b.id;
  const mau = async (ten: string, cong: boolean, chu: number) =>
    (ids[ten] = (await dung(sql`INSERT INTO dashboard_templates (name, "templateType", widgets, layout, "isPublic", "createdBy") VALUES (${RUN + ten}, 'shared', '[]'::json, '[]'::json, ${cong}, ${chu}) RETURNING id`))[0].id);
  await mau("congKhai", true, uB);
  await mau("riengA", false, uA);
  await mau("riengB", false, uB);
  cA = await caller({ id: a.id, role: "supervisor", name: "l6t a" });
  cB = await caller({ id: b.id, role: "supervisor", name: "l6t b" });
  cAdm = await caller({ id: ad.id, role: "admin", name: "l6t ad" });
}, 120_000);

afterAll(async () => {
  await qChuTest(`DELETE FROM dashboard_templates WHERE name LIKE '${RUN}%'`).catch(() => undefined);
});

describe("★★★ mẫu bảng điều khiển — đọc / áp theo id", () => {
  it("getSharedTemplateById / getTemplate — mẫu riêng của B ẩn với A; mẫu công khai và mẫu của chính A đọc được; admin đọc được hết", async () => {
    for (const goi of [(c: C, id: number) => c.w.getSharedTemplateById({ id }), (c: C, id: number) => c.d.getTemplate({ id })]) {
      expect(await goi(cA, ids.riengB)).toBeNull();
      expect((await goi(cA, ids.congKhai))?.id).toBe(ids.congKhai);
      expect((await goi(cA, ids.riengA))?.id).toBe(ids.riengA);
      expect((await goi(cB, ids.riengB))?.id).toBe(ids.riengB);
      expect(await goi(cB, ids.riengA)).toBeNull();
      expect((await goi(cAdm, ids.riengB))?.id).toBe(ids.riengB);
      expect(await goi(cA, 2147483000)).toBeNull();
    }
  });
  it("applyTemplate — mẫu riêng của người khác ⇒ null và KHÔNG tăng usageCount; mẫu hợp lệ trả widgets + tăng", async () => {
    const truoc = await dem(ids.riengB);
    expect(await cA.d.applyTemplate({ templateId: ids.riengB })).toBeNull();
    expect(await dem(ids.riengB)).toBe(truoc);
    const t = await dem(ids.congKhai);
    expect(await cA.d.applyTemplate({ templateId: ids.congKhai })).not.toBeNull();
    expect(await dem(ids.congKhai)).toBe(t + 1);
    expect(await cA.d.applyTemplate({ templateId: ids.riengA })).not.toBeNull();
    expect(await cAdm.d.applyTemplate({ templateId: ids.riengB })).not.toBeNull();
  });
});
