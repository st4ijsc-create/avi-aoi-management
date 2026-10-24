/**
 * ★★★ Lô W9 — phạm vi nhà máy của thủ tục GHI SẢN XUẤT: productionRouters (lệnh · mẫu lệnh · công đoạn · gán sản phẩm-chuyền) · orderLifecycleRouter ·
 * productionSessionRouter (phiên), kiểm định phamViGhi 2026-10-24. Kỹ sư CHỈ gán nhà máy A gọi lên lệnh/chuyền/phiên của nhà máy B.
 * Ngoài phạm vi ≡ NOT_FOUND + dữ liệu B không đổi; hàng MỚI không được nhắm vị trí nhà máy khác / không vị trí.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw9${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay {
  fid: number;
  wid: number;
  lid: number;
  sid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
let pm = 0;
let shiftA = 0;
let uid = 0;
const factories: string[] = [];
let userA!: {
  po: ReturnType<typeof import("./productionRouters").productionOrderRouter.createCaller>;
  st: ReturnType<typeof import("./productionRouters").lineStageRouter.createCaller>;
  asg: ReturnType<typeof import("./productionRouters").lineProductAssignmentRouter.createCaller>;
  lc: ReturnType<typeof import("./orderLifecycleRouter").orderLifecycleRouter.createCaller>;
  ses: ReturnType<typeof import("./productionSessionRouter").productionSessionRouter.createCaller>;
};

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  factories.push(code);
  return { fid: Number(f.id), wid: Number(w.id), lid: Number(l.id), sid: Number(s.id), code };
}
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const NF = "NOT_FOUND";
async function seedDon(nm: NhaMay, ten: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO production_orders ("orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId", "targetQuantity")
    VALUES (${`${RUN}-${ten}`}, 'C', ${nm.fid}, ${nm.wid}, ${nm.lid}, ${pm}, 10) RETURNING id`);
  return Number(r.id);
}
async function seedPhien(nm: NhaMay, ten: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO production_sessions ("sessionCode", "shiftConfigId", "factoryId", "workshopId", "lineId", "operatorId", "shiftDate", "plannedStart", "plannedEnd", "actualStart", status)
    VALUES (${`${RUN}-${ten}`}, ${shiftA}, ${nm.fid}, ${nm.wid}, ${nm.lid}, ${uid}, now(), now(), now(), now(), 'open') RETURNING id`);
  return Number(r.id);
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  pm = Number((await dung(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-pm"}, ${RUN}) RETURNING id`))[0].id);
  shiftA = Number((await dung(sql`INSERT INTO shift_configs (name, code, "startHour", "endHour", "factoryId") VALUES ('s', ${RUN + "-sh"}, 1, 2, ${A.fid}) RETURNING id`))[0].id);
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw9", ts: RUN, ten: "PW9 ua" });
  uid = u.id;
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [
    ["production", "production_orders"],
    ["production", "production_line_assignments"],
    ["production", "production_session"],
    ["settings", "settings_factory"],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  const pr = await import("./productionRouters");
  userA = {
    po: pr.productionOrderRouter.createCaller(ctx),
    st: pr.lineStageRouter.createCaller(ctx),
    asg: pr.lineProductAssignmentRouter.createCaller(ctx),
    lc: (await import("./orderLifecycleRouter")).orderLifecycleRouter.createCaller(ctx),
    ses: (await import("./productionSessionRouter")).productionSessionRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM production_sessions WHERE "sessionCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM line_product_assignments WHERE "productModelId" = ${pm}`).catch(() => undefined);
  await dung(sql`DELETE FROM line_stages WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM production_order_templates WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM order_state_transitions WHERE "orderId" IN (SELECT id FROM production_orders WHERE "orderCode" LIKE ${like})`).catch(() => undefined);
  await dung(sql`DELETE FROM production_orders WHERE "orderCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM shift_configs WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_models WHERE id = ${pm}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("productionOrder — lệnh sản xuất của nhà máy khác", () => {
  it("đối chứng: lệnh nhà máy A ⇒ tạo / sửa được", async () => {
    const r = await userA.po.create({ orderCode: `${RUN}-ca`, companyCode: "C", factoryId: A.fid, workshopId: A.wid, lineId: A.lid, productModelId: pm, targetQuantity: 5 } as never);
    expect((r as any).id ?? r).toBeTruthy();
    const id = await seedDon(A, "ua");
    await userA.po.update({ id, targetQuantity: 11 } as never);
    expect(Number((await one(sql`SELECT "targetQuantity" AS q FROM production_orders WHERE id = ${id}`)).q)).toBe(11);
  });
  it("create nhắm nhà máy / chuyền B ⇒ NOT_FOUND, không hàng; update lệnh B / đẩy lệnh A sang chuyền B ⇒ NOT_FOUND; delete / reschedule lệnh B ⇒ NOT_FOUND", async () => {
    const ib = await seedDon(B, "ub");
    const ia = await seedDon(A, "um");
    const l = [
      await maLoi(() => userA.po.create({ orderCode: `${RUN}-cb`, companyCode: "C", factoryId: B.fid, workshopId: B.wid, lineId: B.lid, productModelId: pm, targetQuantity: 5 } as never)),
      await maLoi(() => userA.po.update({ id: ib, targetQuantity: 99 } as never)),
      await maLoi(() => userA.po.update({ id: ia, lineId: B.lid } as never)),
      await maLoi(() => userA.po.delete({ id: ib } as never)),
      await maLoi(() => userA.po.reschedule({ id: ib, scheduledStartDate: new Date(), scheduledEndDate: new Date(Date.now() + 3600000), lineId: B.lid } as never)),
    ];
    const rb = await one(sql`SELECT "targetQuantity" AS q FROM production_orders WHERE id = ${ib}`);
    expect({ l, hangB: Number((await one(sql`SELECT count(*)::int AS n FROM production_orders WHERE "orderCode" = ${RUN + "-cb"}`)).n), q: Number(rb?.q), aLine: Number((await one(sql`SELECT "lineId" AS l FROM production_orders WHERE id = ${ia}`)).l) }).toEqual({ l: [NF, NF, NF, NF, NF], hangB: 0, q: 10, aLine: A.lid });
  });
  it("mẫu lệnh: tạo nhắm nhà máy B / sửa / xoá mẫu B ⇒ NOT_FOUND", async () => {
    const [tb] = await dung(sql`INSERT INTO production_order_templates (name, "factoryId", "workshopId") VALUES (${RUN + "-tb"}, ${B.fid}, ${B.wid}) RETURNING id`);
    const l = [
      await maLoi(() => userA.po.createTemplate({ name: `${RUN}-tx`, factoryId: B.fid, workshopId: B.wid, productModelId: pm } as never)),
      await maLoi(() => userA.po.updateTemplate({ id: Number(tb.id), name: `${RUN}-hack` } as never)),
      await maLoi(() => userA.po.deleteTemplate({ id: Number(tb.id) } as never)),
    ];
    const con = await one(sql`SELECT name AS n FROM production_order_templates WHERE id = ${tb.id}`);
    expect({ l, n: con?.n }).toEqual({ l: [NF, NF, NF], n: RUN + "-tb" });
  });
});

describe("lineStage / lineProductAssignment — chuyền & công đoạn của nhà máy khác", () => {
  it("công đoạn: tạo vào chuyền B / sửa / xoá / sắp xếp lại ⇒ NOT_FOUND", async () => {
    const [sb] = await dung(sql`INSERT INTO line_stages ("lineId", code, name) VALUES (${B.lid}, ${RUN + "-sb"}, 'sb') RETURNING id`);
    const l = [
      await maLoi(() => userA.st.create({ lineId: B.lid, code: `${RUN}-sx`, name: "sx" } as never)),
      await maLoi(() => userA.st.update({ id: Number(sb.id), name: "hack" } as never)),
      await maLoi(() => userA.st.delete({ id: Number(sb.id) } as never)),
      await maLoi(() => userA.st.reorder({ lineId: B.lid, stageIds: [Number(sb.id)] } as never)),
    ];
    expect({ l, con: Number((await one(sql`SELECT count(*)::int AS n FROM line_stages WHERE id = ${sb.id} AND name = 'sb'`)).n) }).toEqual({ l: [NF, NF, NF, NF], con: 1 });
  });
  it("gán sản phẩm-chuyền: chuyền B ⇒ NOT_FOUND (tạo / sửa / xoá)", async () => {
    const [gb] = await dung(sql`INSERT INTO line_product_assignments ("lineId", "productModelId") VALUES (${B.lid}, ${pm}) RETURNING id`);
    const l = [
      await maLoi(() => userA.asg.create({ lineId: B.lid, productModelId: pm } as never)),
      await maLoi(() => userA.asg.update({ id: Number(gb.id), isActive: false } as never)),
      await maLoi(() => userA.asg.delete({ id: Number(gb.id) } as never)),
    ];
    expect({ l, con: Number((await one(sql`SELECT count(*)::int AS n FROM line_product_assignments WHERE id = ${gb.id}`)).n) }).toEqual({ l: [NF, NF, NF], con: 1 });
  });
});

describe("orderLifecycle & productionSession", () => {
  it("hold / resume / cancel / allocate lệnh B ⇒ NOT_FOUND, lệnh B nguyên vẹn; lệnh A qua cổng", async () => {
    const ib = await seedDon(B, "lb");
    const ia = await seedDon(A, "la");
    const l = [
      await maLoi(() => userA.lc.hold({ orderId: ib } as never)),
      await maLoi(() => userA.lc.resume({ orderId: ib } as never)),
      await maLoi(() => userA.lc.cancel({ orderId: ib } as never)),
      await maLoi(() => userA.lc.allocate({ orderId: ib, lineId: B.lid } as never)),
      await maLoi(() => userA.lc.allocate({ orderId: ia, lineId: B.lid } as never)),
    ];
    const aQua = await maLoi(() => userA.lc.hold({ orderId: ia } as never));
    expect({ l, aQuaCong: aQua !== NF, ttB: (await one(sql`SELECT status AS s FROM production_orders WHERE id = ${ib}`)).s }).toEqual({ l: [NF, NF, NF, NF, NF], aQuaCong: true, ttB: (await one(sql`SELECT status AS s FROM production_orders WHERE id = ${ib}`)).s });
    expect(Number((await one(sql`SELECT count(*)::int AS n FROM order_state_transitions WHERE "orderId" = ${ib}`)).n)).toBe(0);
  });
  it("phiên: mở nhắm nhà máy B ⇒ NOT_FOUND; pause / resume / close / supervisorSignOff / handover phiên B ⇒ NOT_FOUND, phiên B vẫn 'open'", async () => {
    const sb = await seedPhien(B, "sb");
    const sa = await seedPhien(A, "sa");
    const l = [
      await maLoi(() => userA.ses.open({ shiftConfigId: shiftA, factoryId: B.fid, workshopId: B.wid, lineId: B.lid, operatorId: uid, shiftDate: new Date().toISOString(), plannedStart: new Date().toISOString(), plannedEnd: new Date().toISOString() } as never)),
      await maLoi(() => userA.ses.pause({ id: sb } as never)),
      await maLoi(() => userA.ses.resume({ id: sb } as never)),
      await maLoi(() => userA.ses.close({ id: sb } as never)),
      await maLoi(() => userA.ses.supervisorSignOff({ id: sb, supervisorPasswordConfirmed: true } as never)),
      await maLoi(() => userA.ses.handover({ fromSessionId: sa, toSessionId: sb, handoverNotes: "x" } as never)),
    ];
    expect({ l, st: (await one(sql`SELECT status AS s FROM production_sessions WHERE id = ${sb}`)).s }).toEqual({ l: [NF, NF, NF, NF, NF, NF], st: "open" });
  });
});
