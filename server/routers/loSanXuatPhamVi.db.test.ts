/**
 * CỔNG CSDL THẬT — lô L5 (rà bảo mật tRPC, 2026-10-25): ĐỌC của orderLifecycle · productionSession · lineController (kể cả recipeSet) · wip theo PHẠM VI người dùng.
 *
 * Lỗ: người dùng nhà máy A liệt kê / mở chi tiết / truy vết lệnh sản xuất, phiên sản xuất (kể cả chữ ký ký duyệt), trạng thái + trạm + checklist + lịch sử chuyển trạng thái của tuyến,
 * recipe set (mã công thức, máy), WIP + dwell + điều phối của MỌI nhà máy. Luật: ngoài phạm vi ≡ không tồn tại (cùng NOT_FOUND / null / rỗng như thực thể không có thật); admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

process.env.ORDER_LIFECYCLE_ENABLED = "true";

const RUN = `l5${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

interface Nm { fid: number; wid: number; lid: number; sid: number; mid: number; code: string; order: number; session: number; set: number; userId: number; serial: string; setCode: string }
let A!: Nm;
let B!: Nm;
let setNhap = 0;
let setLai = 0;
const uids: number[] = [];
type C = { orderLifecycle: any; productionSession: any; lineController: any; wip: any };
let uA: C, uAdmin: C, uRong: C;
let modelId = 0;

async function qChu(q: string): Promise<void> {
  const { default: postgres } = await import("postgres");
  const u = new URL(process.env.DATABASE_URL!);
  if (!/_test$/.test(u.pathname.replace(/^\//, ""))) throw new Error("từ chối: không phải CSDL _test");
  u.username = "aoi";
  u.password = "aoi";
  const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try { await chu.unsafe(q); } finally { await chu.end({ timeout: 5 }); }
}
async function chiTiet(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const x = e as { code?: string };
    const meta = readAppErrorMeta(e);
    const pr = (meta?.appParams ?? {}) as { entity?: string; operation?: string; field?: string };
    return `${x.code ?? "?"}:${meta?.appCode ?? "?"}:${pr.entity ?? pr.operation ?? pr.field ?? ""}`;
  }
}

async function seed(ten: string): Promise<Nm> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "supervisor", { tienTo: "l5", ts: RUN, ten: `L5 ${ten}` });
  uids.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  const [o] = await dung(sql`INSERT INTO production_orders ("orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId", "targetQuantity")
    VALUES (${code + "-O"}, ${code}, ${f.id}, ${w.id}, ${l.id}, ${modelId}, 10) RETURNING id`);
  await dung(sql`INSERT INTO order_state_transitions ("orderId", "toState", reason) VALUES (${o.id}, 'created', ${"lydo-" + code})`);
  const [sc] = await dung(sql`INSERT INTO shift_configs ("factoryId", name, code, "startHour", "endHour") VALUES (${f.id}, ${code}, ${code}, 6, 14) RETURNING id`);
  const [ss] = await dung(sql`INSERT INTO production_sessions ("sessionCode", "shiftConfigId", "factoryId", "workshopId", "lineId", "operatorId", "shiftDate", "plannedStart", "plannedEnd", "actualStart", status, "supervisorSignoff", "signoffPayload", "signoffPayloadHash", "signoffSignature")
    VALUES (${code + "-S"}, ${sc.id}, ${f.id}, ${w.id}, ${l.id}, ${u.id}, now(), now(), now(), now(), 'closed', true, 'p', 'h', 's') RETURNING id`);
  const serial = `${code}-SN`;
  await dung(sql`INSERT INTO wip_tracking ("serialNumber", "lineId", "currentStationId", "currentMachineId", status) VALUES (${serial}, ${l.id}, ${s.id}, ${m.id}, 'in_process')`);
  await dung(sql`INSERT INTO station_dwell_time ("lineId", "stationId", "machineId", "serialNumber", "dwellMs", "enteredAt") VALUES (${l.id}, ${s.id}, ${m.id}, ${serial}, 1000, now())`);
  await dung(sql`INSERT INTO line_balance_metrics ("lineId", "periodStart", "periodEnd", "bottleneckStationId") VALUES (${l.id}, now() - interval '1 hour', now(), ${s.id})`);
  await dung(sql`INSERT INTO line_states (line_id, state) VALUES (${l.id}, 'idle')`);
  await dung(sql`INSERT INTO line_state_transitions (line_id, from_state, to_state, reason) VALUES (${l.id}, 'idle', 'ready', ${"lydo-" + code})`);
  const setCode = `${code}-SET`;
  const [rs] = await dung(sql`INSERT INTO recipe_sets (code) VALUES (${setCode}) RETURNING id`);
  const [mr] = await dung(sql`INSERT INTO machine_recipes ("machineId", code, name, version, payload) VALUES (${m.id}, ${code + "-RC"}, ${code}, 1, '{}'::jsonb) RETURNING id`);
  await dung(sql`INSERT INTO recipe_set_items (recipe_set_id, machine_id, machine_recipe_id) VALUES (${rs.id}, ${m.id}, ${mr.id})`);
  return { fid: f.id, wid: w.id, lid: l.id, sid: s.id, mid: m.id, code, order: o.id, session: ss.id, set: rs.id, userId: u.id, serial, setCode };
}

const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [o, p, l, w] = await Promise.all([
    import("./orderLifecycleRouter").then((m) => m.orderLifecycleRouter.createCaller(ctx)),
    import("./productionSessionRouter").then((m) => m.productionSessionRouter.createCaller(ctx)),
    import("./lineControllerRouter").then((m) => m.lineControllerRouter.createCaller(ctx)),
    import("./wipRouter").then((m) => m.wipRouter.createCaller(ctx)),
  ]);
  return { orderLifecycle: o, productionSession: p, lineController: l, wip: w };
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const [pm] = await dung(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-PM"}, ${RUN}) RETURNING id`);
  modelId = pm.id;
  A = await seed("A");
  B = await seed("B");
  // set nháp (không item) và set lai (item máy A + máy B) — cùng luật với GHI: nháp ai cũng thấy; lai ⇒ ẩn với người chỉ có A
  setNhap = (await dung(sql`INSERT INTO recipe_sets (code) VALUES (${RUN + "-NHAP"}) RETURNING id`))[0].id;
  setLai = (await dung(sql`INSERT INTO recipe_sets (code) VALUES (${RUN + "-LAI"}) RETURNING id`))[0].id;
  for (const nm of [A, B]) {
    const [mr] = await dung(sql`SELECT id FROM machine_recipes WHERE "machineId" = ${nm.mid} LIMIT 1`);
    await dung(sql`INSERT INTO recipe_set_items (recipe_set_id, machine_id, machine_recipe_id) VALUES (${setLai}, ${nm.mid}, ${mr.id})`);
  }
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "l5", ts: RUN, ten: "L5 ad" });
  const ur = await taoNguoiDungTest("ur", "supervisor", { tienTo: "l5", ts: RUN, ten: "L5 ur" });
  uids.push(ad.id, ur.id);
  for (const uid of [A.userId, B.userId, ur.id]) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${uid}, 'production'::permissioncategoryenum, 'production_orders', true, true, true, true)`);
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${uid}, 'machine_monitoring'::permissioncategoryenum, 'machine_status', true, true, true, true)`);
  }
  uA = await caller({ id: A.userId, role: "supervisor", name: "L5 A" });
  uAdmin = await caller({ id: ad.id, role: "admin", name: "L5 ad" });
  uRong = await caller({ id: ur.id, role: "supervisor", name: "L5 ur" });
}, 240_000);

afterAll(async () => {
  if (!db) return;
  const k = (s: string) => s.replace(/'/g, "''");
  const like = `'${k(RUN)}%'`;
  const stmts = [
    `DELETE FROM order_state_transitions WHERE "orderId" IN (SELECT id FROM production_orders WHERE "orderCode" LIKE ${like})`,
    `DELETE FROM production_sessions WHERE "sessionCode" LIKE ${like}`,
    `DELETE FROM production_orders WHERE "orderCode" LIKE ${like}`,
    `DELETE FROM shift_configs WHERE code LIKE ${like}`,
    `DELETE FROM wip_tracking WHERE "serialNumber" LIKE ${like}`,
    `DELETE FROM station_dwell_time WHERE "serialNumber" LIKE ${like}`,
    `DELETE FROM line_balance_metrics WHERE "lineId" IN (SELECT id FROM production_lines WHERE code LIKE ${like})`,
    `DELETE FROM line_state_transitions WHERE line_id IN (SELECT id FROM production_lines WHERE code LIKE ${like})`,
    `DELETE FROM line_states WHERE line_id IN (SELECT id FROM production_lines WHERE code LIKE ${like})`,
    `DELETE FROM recipe_set_items WHERE recipe_set_id IN (SELECT id FROM recipe_sets WHERE code LIKE ${like})`,
    `DELETE FROM recipe_sets WHERE code LIKE ${like}`,
    `DELETE FROM machine_recipes WHERE code LIKE ${like}`,
    `DELETE FROM product_models WHERE code LIKE ${like}`,
    `DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`,
    ...["machines", "stations", "production_lines", "workshops", "factories"].map((t) => `DELETE FROM ${t} WHERE code LIKE ${like}`),
  ];
  for (const s of stmts) { try { await qChu(s); } catch { /* dọn best-effort */ } }
});

describe("★★★ orderLifecycle — ĐỌC", () => {
  it("list — chỉ lệnh của A; admin thấy cả hai; phạm vi rỗng thấy 0 lệnh của hai bên", async () => {
    const ids = (await uA.orderLifecycle.list({ limit: 200 })).orders.map((o: { id: number }) => o.id);
    expect(ids).toContain(A.order);
    expect(ids).not.toContain(B.order);
    const adm = (await uAdmin.orderLifecycle.list({ limit: 200 })).orders.map((o: { id: number }) => o.id);
    expect(adm).toContain(A.order);
    expect(adm).toContain(B.order);
    const rong = (await uRong.orderLifecycle.list({ limit: 200 })).orders.map((o: { id: number }) => o.id);
    expect(rong).not.toContain(A.order);
    expect(rong).not.toContain(B.order);
  });
  it("detail / trace — lệnh B ⇒ NOT_FOUND giống lệnh không có thật; lệnh A đọc được (kể cả lịch sử)", async () => {
    const thatB = await chiTiet(() => uA.orderLifecycle.detail({ orderId: B.order }));
    const khongCo = await chiTiet(() => uA.orderLifecycle.detail({ orderId: 2147483000 }));
    expect(thatB).toBe("NOT_FOUND:ENTITY_NOT_FOUND:productionOrder");
    expect(thatB).toBe(khongCo);
    expect(await chiTiet(() => uA.orderLifecycle.trace({ orderId: B.order }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:productionOrder");
    const d = await uA.orderLifecycle.detail({ orderId: A.order });
    expect(d.transitions.map((t: { reason: string }) => t.reason)).toContain("lydo-" + A.code);
    expect((await uA.orderLifecycle.trace({ orderId: A.order })).order.id).toBe(A.order);
    expect((await uAdmin.orderLifecycle.detail({ orderId: B.order })).order.id).toBe(B.order);
  });
});

describe("★★★ productionSession — ĐỌC", () => {
  it("list — chỉ phiên của A; lọc factoryId của B không mở được; admin thấy cả hai", async () => {
    const ids = (await uA.productionSession.list({ limit: 500 })).map((s: { id: number }) => s.id);
    expect(ids).toContain(A.session);
    expect(ids).not.toContain(B.session);
    const loc = (await uA.productionSession.list({ factoryId: B.fid, limit: 500 })).map((s: { id: number }) => s.id);
    expect(loc).not.toContain(B.session);
    const adm = (await uAdmin.productionSession.list({ limit: 500 })).map((s: { id: number }) => s.id);
    expect(adm).toContain(A.session);
    expect(adm).toContain(B.session);
    const rong = (await uRong.productionSession.list({ limit: 500 })).map((s: { id: number }) => s.id);
    expect(rong).not.toContain(A.session);
    expect(rong).not.toContain(B.session);
  });
  it("★★★ phiên LAI (nhà máy / xưởng / chuyền lệch sang B) — A không thấy; phiên của A không chuyền vẫn thấy", async () => {
    const [sc] = await dung(sql`SELECT id FROM shift_configs WHERE code = ${A.code}`);
    const them = async (ten: string, f: number, w: number, l: number | null) =>
      (await dung(sql`INSERT INTO production_sessions ("sessionCode", "shiftConfigId", "factoryId", "workshopId", "lineId", "operatorId", "shiftDate", "plannedStart", "plannedEnd", "actualStart", status)
        VALUES (${A.code + "-" + ten}, ${sc.id}, ${f}, ${w}, ${l}, ${A.userId}, now(), now(), now(), now(), 'open') RETURNING id`))[0].id as number;
    const laiF = await them("LF", B.fid, A.wid, A.lid);
    const laiW = await them("LW", A.fid, B.wid, A.lid);
    const laiL = await them("LL", A.fid, A.wid, B.lid);
    const khongChuyen = await them("KC", A.fid, A.wid, null);
    const ids = (await uA.productionSession.list({ limit: 500 })).map((s: { id: number }) => s.id);
    for (const x of [laiF, laiW, laiL]) {
      expect(ids).not.toContain(x);
      expect(await chiTiet(() => uA.productionSession.getById({ id: x }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:productionSession");
    }
    expect(ids).toContain(khongChuyen);
    const adm = (await uAdmin.productionSession.list({ limit: 500 })).map((s: { id: number }) => s.id);
    for (const x of [laiF, laiW, laiL]) expect(adm).toContain(x);
  });
  it("getById / verifySignoff — phiên B ⇒ NOT_FOUND giống phiên không có thật; phiên A đọc được", async () => {
    const thatB = await chiTiet(() => uA.productionSession.getById({ id: B.session }));
    const khongCo = await chiTiet(() => uA.productionSession.getById({ id: 2147483000 }));
    expect(thatB).toBe("NOT_FOUND:ENTITY_NOT_FOUND:productionSession");
    expect(thatB).toBe(khongCo);
    expect(await chiTiet(() => uA.productionSession.verifySignoff({ id: B.session }))).toBe(khongCo);
    expect((await uA.productionSession.getById({ id: A.session })).id).toBe(A.session);
    expect((await uAdmin.productionSession.getById({ id: B.session })).id).toBe(B.session);
  });
});

describe("★★★ lineController — ĐỌC", () => {
  it("listStates — chỉ tuyến của A (kể cả khi khai factoryId của B); admin thấy cả hai", async () => {
    const ids = (await uA.lineController.listStates()).map((l: { lineId: number }) => l.lineId);
    expect(ids).toContain(A.lid);
    expect(ids).not.toContain(B.lid);
    const loc = (await uA.lineController.listStates({ factoryId: B.fid })).map((l: { lineId: number }) => l.lineId);
    expect(loc).not.toContain(B.lid);
    const adm = (await uAdmin.lineController.listStates()).map((l: { lineId: number }) => l.lineId);
    expect(adm).toContain(A.lid);
    expect(adm).toContain(B.lid);
  });
  it("getState / stages — tuyến B ⇒ null giống tuyến không có thật; tuyến A đọc được", async () => {
    expect(await uA.lineController.getState({ lineId: B.lid })).toBeNull();
    expect(await uA.lineController.getState({ lineId: 2147483000 })).toBeNull();
    expect(await uA.lineController.stages({ lineId: B.lid })).toBeNull();
    expect((await uA.lineController.getState({ lineId: A.lid }))?.lineId).toBe(A.lid);
    expect((await uA.lineController.stages({ lineId: A.lid }))?.lineId).toBe(A.lid);
    expect((await uAdmin.lineController.getState({ lineId: B.lid }))?.lineId).toBe(B.lid);
  });
  it("transitions — lịch sử tuyến B rỗng; tuyến A có; readiness tuyến B giống tuyến không có thật", async () => {
    expect(await uA.lineController.transitions({ lineId: B.lid })).toEqual([]);
    expect((await uA.lineController.transitions({ lineId: A.lid })).map((t: { reason: string }) => t.reason)).toContain("lydo-" + A.code);
    expect((await uAdmin.lineController.transitions({ lineId: B.lid })).length).toBeGreaterThan(0);
    const rB = await uA.lineController.readiness({ lineId: B.lid });
    const rKhong = await uA.lineController.readiness({ lineId: 2147483000 });
    expect(rB.checks.map((c: { name: string; passed: boolean; detail: string }) => [c.name, c.passed, c.detail])).toEqual(rKhong.checks.map((c: { name: string; passed: boolean; detail: string }) => [c.name, c.passed, c.detail]));
    expect(JSON.stringify(rB)).not.toContain(B.code);
  });
  it("recipeSet.list — set của A + nháp, KHÔNG có set của B hay set lai; admin thấy hết", async () => {
    const codes = (await uA.lineController.recipeSet.list({ limit: 500 })).map((s: { code: string }) => s.code);
    expect(codes).toContain(A.setCode);
    expect(codes).toContain(RUN + "-NHAP");
    expect(codes).not.toContain(B.setCode);
    expect(codes).not.toContain(RUN + "-LAI");
    const adm = (await uAdmin.lineController.recipeSet.list({ limit: 500 })).map((s: { code: string }) => s.code);
    for (const c of [A.setCode, B.setCode, RUN + "-LAI", RUN + "-NHAP"]) expect(adm).toContain(c);
  });
  it("recipeSet.get / lockStatus — set B và set lai ⇒ null giống set không có thật; set A đọc được", async () => {
    for (const ref of [{ id: B.set }, { code: B.setCode }, { id: setLai }]) {
      expect(await uA.lineController.recipeSet.get(ref)).toBeNull();
      expect(await uA.lineController.recipeSet.lockStatus(ref)).toBeNull();
    }
    expect(await uA.lineController.recipeSet.get({ id: 2147483000 })).toBeNull();
    expect((await uA.lineController.recipeSet.get({ id: A.set }))?.recipeSet.id).toBe(A.set);
    expect((await uA.lineController.recipeSet.lockStatus({ code: A.setCode }))?.id).toBe(A.set);
    expect((await uAdmin.lineController.recipeSet.get({ id: B.set }))?.recipeSet.id).toBe(B.set);
  });
  it("recipeSet.lockStatus — tuyến của B đang dùng set A thì A KHÔNG thấy tuyến B; admin thấy", async () => {
    await dung(sql`UPDATE line_states SET recipe_set_ref = ${A.setCode} WHERE line_id = ${B.lid}`);
    await dung(sql`UPDATE line_states SET recipe_set_ref = ${A.setCode} WHERE line_id = ${A.lid}`);
    const a = (await uA.lineController.recipeSet.lockStatus({ id: A.set }))?.linesUsing.map((l: { lineId: number }) => l.lineId) ?? [];
    expect(a).toContain(A.lid);
    expect(a).not.toContain(B.lid);
    const adm = (await uAdmin.lineController.recipeSet.lockStatus({ id: A.set }))?.linesUsing.map((l: { lineId: number }) => l.lineId) ?? [];
    expect(adm).toContain(B.lid);
  });
  it("status — sự kiện gần nhất chỉ của tuyến A (sự kiện tuyến B bị lọc)", async () => {
    const dv = await import("../services/lineController/lineControllerService");
    dv._resetLineControllerForTests();
    dv._ghiSuKienChoTest({ kind: "blocking", lineId: B.lid, detail: "b-" + RUN } as never);
    dv._ghiSuKienChoTest({ kind: "blocking", lineId: A.lid, detail: "a-" + RUN } as never);
    const ev = (await uA.lineController.status()).recentEvents.map((e: { detail: string }) => e.detail);
    expect(ev).toContain("a-" + RUN);
    expect(ev).not.toContain("b-" + RUN);
    const adm = (await uAdmin.lineController.status()).recentEvents.map((e: { detail: string }) => e.detail);
    expect(adm).toContain("b-" + RUN);
    dv._resetLineControllerForTests();
  });
});

describe("★★★ wip — ĐỌC", () => {
  it("list — chỉ WIP của A; khai lineId của B vẫn không thấy; admin thấy cả hai", async () => {
    const sn = (await uA.wip.list({ limit: 500 })).map((w: { serialNumber: string }) => w.serialNumber);
    expect(sn).toContain(A.serial);
    expect(sn).not.toContain(B.serial);
    expect((await uA.wip.list({ lineId: B.lid, limit: 500 })).map((w: { serialNumber: string }) => w.serialNumber)).not.toContain(B.serial);
    const adm = (await uAdmin.wip.list({ limit: 500 })).map((w: { serialNumber: string }) => w.serialNumber);
    expect(adm).toContain(A.serial);
    expect(adm).toContain(B.serial);
    expect((await uRong.wip.list({ limit: 500 })).map((w: { serialNumber: string }) => w.serialNumber)).not.toContain(A.serial);
  });
  it("summary — đếm theo tuyến B của A = 0; đếm tuyến A ≥ 1; admin đếm tuyến B ≥ 1", async () => {
    expect((await uA.wip.summary({ lineId: B.lid })).total).toBe(0);
    expect((await uA.wip.summary({ lineId: A.lid })).total).toBeGreaterThanOrEqual(1);
    expect((await uAdmin.wip.summary({ lineId: B.lid })).total).toBeGreaterThanOrEqual(1);
    expect((await uRong.wip.summary({ lineId: A.lid })).total).toBe(0);
  });
  it("dwellByStation — trạm B không lọt vào kết quả của A (kể cả không khai lineId)", async () => {
    const st = (await uA.wip.dwellByStation({ hours: 24 })).map((r: { stationId: number }) => r.stationId);
    expect(st).toContain(A.sid);
    expect(st).not.toContain(B.sid);
    expect((await uA.wip.dwellByStation({ lineId: B.lid })).map((r: { stationId: number }) => r.stationId)).not.toContain(B.sid);
    expect((await uAdmin.wip.dwellByStation({ hours: 24 })).map((r: { stationId: number }) => r.stationId)).toContain(B.sid);
  });
  it("dispatch — hàng dwell của trạm A nhưng gắn tuyến B KHÔNG ảnh hưởng điểm xếp hạng của A", async () => {
    const diem = async () => (await uA.wip.dispatch({ max: 200 })).recommendations.find((r: { serialNumber: string }) => r.serialNumber === A.serial)?.score;
    const truoc = await diem();
    expect(truoc).toBeDefined();
    await dung(sql`INSERT INTO station_dwell_time ("lineId", "stationId", "machineId", "serialNumber", "dwellMs", "blockedMs", "starvedMs", "enteredAt") VALUES (${B.lid}, ${A.sid}, ${B.mid}, ${B.serial}, 99999999, 99999999, 99999999, now())`);
    expect(await diem()).toBe(truoc);
  });
  it("dispatch — khuyến nghị / điểm nghẽn của B không lọt vào kết quả của A", async () => {
    const r = await uA.wip.dispatch({ max: 200 });
    expect(r.bottleneckStationIds).toContain(A.sid);
    expect(r.bottleneckStationIds).not.toContain(B.sid);
    expect(JSON.stringify(r)).not.toContain(B.serial);
    expect(JSON.stringify(await uA.wip.dispatch({ lineId: B.lid }))).not.toContain(B.serial);
    expect((await uA.wip.dispatch({ lineId: B.lid })).bottleneckStationIds).not.toContain(B.sid);
    expect(JSON.stringify(await uAdmin.wip.dispatch({ lineId: B.lid }))).toContain(B.serial);
    expect((await uAdmin.wip.dispatch({ max: 200 })).bottleneckStationIds).toContain(B.sid);
  });
});
