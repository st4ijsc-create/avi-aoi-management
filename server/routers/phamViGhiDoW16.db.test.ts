/**
 * ★★★ Lô W16 — KHO VẬT TƯ THEO NHÀ MÁY (mig 0424) + QUY TẮC LEO THANG THEO NHÀ MÁY (mig 0425), quyết định chủ dự án 2026-10-25 (W14-Q2/Q3), đọc VÀ ghi.
 * Giám sát viên CHỈ gán nhà máy A: phụ tùng / phiếu nhập / lô NCC / quyết định lô của B ⇒ không thấy, không ghi (NOT_FOUND); hàng chưa gán nhà máy chỉ toàn quyền;
 * cùng mã phụ tùng ở hai nhà máy có tồn kho riêng; ngưỡng cần nhập = max(reorderLevel, 3 % số máy); quy tắc leo thang: mặc định (NULL) chỉ toàn quyền sửa, nhà máy tự quyết quy tắc riêng,
 * ghi đè theo cặp (severity, alertType) ở bộ quét mqttAlertScheduler.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw20${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const so = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);
const NF = "NOT_FOUND";
interface NhaMay {
  fid: number;
  mid: number;
  code: string;
  wo: number;
  phuTung: number;
  conn: number;
}
let A!: NhaMay;
let B!: NhaMay;
let uidA = 0;
let phuTungChua = 0;
const factories: string[] = [];
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const ma = String((e as { code?: string }).code ?? "LOI_LA");
    return ma === NF ? ma : `${ma}:${(e as Error).message.slice(0, 110)}`;
  }
}
const ma = (x: string | null) => (x ?? "").split(":")[0];
const PC = `${RUN}-PT`; // CÙNG mã ở cả hai nhà máy

async function seed(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  const [wo] = await dung(sql`INSERT INTO maintenance_work_orders ("workOrderNumber", "machineId", title) VALUES (${code + "-wo"}, ${m.id}, ${code + "-wo"}) RETURNING id`);
  const [pt] = await dung(sql`INSERT INTO spare_parts_inventory ("partCode", "partName", "quantityOnHand", "reorderLevel", "factoryId") VALUES (${PC}, ${code + "-pt"}, 5, 0, ${f.id}) RETURNING id`);
  const [cn] = await dung(sql`INSERT INTO mqtt_connection_alerts ("profileId", "targetType", "targetId", "alertType", title, severity, "triggeredAt")
    VALUES (1, 'machine', ${m.id}, 'connection_lost', ${code + "-al"}, 'critical', now() - interval '3 hours') RETURNING id`);
  factories.push(code);
  return { fid: Number(f.id), mid: Number(m.id), code, wo: Number(wo.id), phuTung: Number(pt.id), conn: Number(cn.id) };
}

let c!: {
  mt: ReturnType<typeof import("./maintenanceRouter").maintenanceRouter.createCaller>;
  mes: ReturnType<typeof import("./mesControlTowerRouter").mesControlTowerRouter.createCaller>;
  esc: ReturnType<typeof import("./alertEscalationRouter").alertEscalationRouter.createCaller>;
  escAdmin: ReturnType<typeof import("./alertEscalationRouter").alertEscalationRouter.createCaller>;
  mtAdmin: ReturnType<typeof import("./maintenanceRouter").maintenanceRouter.createCaller>;
  mesAdmin: ReturnType<typeof import("./mesControlTowerRouter").mesControlTowerRouter.createCaller>;
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const u = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw20", ts: RUN, ten: "PW20 ua" });
  const adm = await taoNguoiDungTest("uadm", "admin", { tienTo: "pw20", ts: RUN, ten: "PW20 adm" });
  uidA = u.id;
  A = await seed("a");
  B = await seed("b");
  // phụ tùng chưa gán nhà máy (chỉ toàn quyền) + phụ tùng "chưa từng dùng" để thử ngưỡng
  phuTungChua = Number((await one(sql`INSERT INTO spare_parts_inventory ("partCode", "partName", "quantityOnHand", "reorderLevel") VALUES (${RUN + "-NULL"}, 'chua gan', 1, 0) RETURNING id`)).id);
  // A đã dùng phụ tùng PC trên 1 máy ⇒ số máy = 1 ⇒ mức tối thiểu 1
  await dung(sql`INSERT INTO work_order_parts ("workOrderId", "sparePartId", "partCode", "quantityUsed") VALUES (${A.wo}, ${A.phuTung}, ${PC}, 1)`);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [
    ["machine_monitoring", "machine_monitoring"],
    ["machine_monitoring", "machine_status"],
    ["machine_monitoring", "mes_control_tower"],
    ["machine_monitoring", "mes_inventory"],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "supervisor", name: u.name, twoFactorEnabled: true } } as never;
  const ctxAdm = { user: { id: adm.id, role: "admin", name: adm.name, twoFactorEnabled: true } } as never;
  c = {
    mt: (await import("./maintenanceRouter")).maintenanceRouter.createCaller(ctx),
    mes: (await import("./mesControlTowerRouter")).mesControlTowerRouter.createCaller(ctx),
    esc: (await import("./alertEscalationRouter")).alertEscalationRouter.createCaller(ctx),
    escAdmin: (await import("./alertEscalationRouter")).alertEscalationRouter.createCaller(ctxAdm),
    mtAdmin: (await import("./maintenanceRouter")).maintenanceRouter.createCaller(ctxAdm),
    mesAdmin: (await import("./mesControlTowerRouter")).mesControlTowerRouter.createCaller(ctxAdm),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM alert_escalation_rules WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_connection_alerts WHERE title LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM lot_disposition WHERE "lotNumber" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM supplier_lots WHERE "supplierLotNumber" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM material_receipts WHERE "receiptNumber" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM work_order_parts WHERE "partCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM spare_parts_inventory WHERE "partCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM maintenance_work_orders WHERE title LIKE ${like}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("phụ tùng theo nhà máy (maintenanceRouter)", () => {
  it("partsBelowReorder: người hẹp thấy tồn kho nhà máy A (không B, không hàng chưa gán); ngưỡng = max(reorderLevel, 3 % số máy; không rõ ⇒ 3)", async () => {
    // A: tồn 5, reorder 0, số máy dùng = 1 ⇒ mức 1 ⇒ 5 > 1 ⇒ KHÔNG cần nhập
    let r = await c.mt.partsBelowReorder();
    expect(r.map((x) => x.partCode)).not.toContain(PC);
    await dung(sql`UPDATE spare_parts_inventory SET "quantityOnHand" = 1 WHERE id IN (${A.phuTung}, ${B.phuTung})`);
    r = await c.mt.partsBelowReorder();
    const cuaA = r.filter((x) => x.partCode === PC);
    expect(cuaA.length).toBe(1); // chỉ hàng của A; B (cùng mã) và hàng chưa gán không lộ
    expect(cuaA[0]).toMatchObject({ factoryId: A.fid, soMayDung: 1, mucToiThieu: 1, nguongCanNhap: 1 });
    expect(r.map((x) => x.partCode)).not.toContain(RUN + "-NULL");
    // toàn quyền thấy cả B và hàng chưa gán (số máy không rõ ⇒ mức 3 ⇒ tồn 1 ≤ 3)
    const tat = await c.mtAdmin.partsBelowReorder({ limit: 500 });
    expect(tat.filter((x) => x.partCode === PC).map((x) => x.factoryId).sort()).toEqual([A.fid, B.fid].sort());
    const chua = tat.find((x) => x.partCode === RUN + "-NULL");
    expect(chua).toMatchObject({ soMayDung: null, mucToiThieu: 3, nguongCanNhap: 3 });
  });
  it("recordPartsUsed: tiêu hao theo MÃ chọn đúng tồn kho của nhà máy phiếu; phiếu A không trừ tồn kho B; phụ tùng chưa gán / nhà máy khác ⇒ NOT_FOUND", async () => {
    await dung(sql`UPDATE spare_parts_inventory SET "quantityOnHand" = 10 WHERE id IN (${A.phuTung}, ${B.phuTung})`);
    const r = await c.mt.recordPartsUsed({ workOrderId: A.wo, partCode: PC, quantityUsed: 2 });
    expect(r.inventory?.id).toBe(A.phuTung);
    expect(await so(sql`SELECT "quantityOnHand"::int AS n FROM spare_parts_inventory WHERE id = ${A.phuTung}`)).toBe(8);
    expect(await so(sql`SELECT "quantityOnHand"::int AS n FROM spare_parts_inventory WHERE id = ${B.phuTung}`)).toBe(10);
    const l = [
      await maLoi(() => c.mt.recordPartsUsed({ workOrderId: A.wo, sparePartId: B.phuTung, quantityUsed: 1 })), // tồn kho nhà máy B trên phiếu A
      await maLoi(() => c.mt.recordPartsUsed({ workOrderId: A.wo, sparePartId: phuTungChua, quantityUsed: 1 })), // chưa gán nhà máy
      await maLoi(() => c.mt.recordPartsUsed({ workOrderId: B.wo, partCode: PC, quantityUsed: 1 })), // phiếu nhà máy B (ngoài phạm vi)
    ];
    expect(l).toEqual([NF, NF, NF]);
    expect(await so(sql`SELECT "quantityOnHand"::int AS n FROM spare_parts_inventory WHERE id = ${B.phuTung}`)).toBe(10);
    expect(await so(sql`SELECT "quantityOnHand"::int AS n FROM spare_parts_inventory WHERE id = ${phuTungChua}`)).toBe(1);
  });
});

describe("kho vật tư (mesControlTower): phiếu nhập · lô NCC · quyết định lô", () => {
  it("tạo theo nhà máy: người hẹp khai nhà máy B / không suy được nhà máy ⇒ NOT_FOUND; nhà máy A ⇒ đóng dấu; lô suy từ phiếu; quyết định suy từ lô; mâu thuẫn ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => c.mes.createMaterialReceipt({ receiptNumber: `${RUN}-rb`, materialCode: `${RUN}-MAT`, quantity: 1, factoryId: B.fid })),
      await maLoi(() => c.mes.createMaterialReceipt({ receiptNumber: `${RUN}-rn`, materialCode: `${RUN}-MAT`, quantity: 1 })),
    ];
    expect(l).toEqual([NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM material_receipts WHERE "receiptNumber" LIKE ${RUN + "-r%"}`)).toBe(0);
    const pa = await c.mes.createMaterialReceipt({ receiptNumber: `${RUN}-ra`, materialCode: `${RUN}-MAT`, quantity: 1, factoryId: A.fid });
    expect(await so(sql`SELECT count(*)::int AS n FROM material_receipts WHERE id = ${pa.id} AND "factoryId" = ${A.fid}`)).toBe(1);
    const pb = await c.mesAdmin.createMaterialReceipt({ receiptNumber: `${RUN}-rB`, materialCode: `${RUN}-MAT`, quantity: 1, factoryId: B.fid });
    const lot = await c.mes.createSupplierLot({ supplierLotNumber: `${RUN}-lotA`, materialCode: `${RUN}-MAT`, quantity: 1, receiptId: pa.id });
    expect(await so(sql`SELECT count(*)::int AS n FROM supplier_lots WHERE id = ${lot.id} AND "factoryId" = ${A.fid}`)).toBe(1);
    const l2 = [
      await maLoi(() => c.mes.createSupplierLot({ supplierLotNumber: `${RUN}-lotx`, materialCode: `${RUN}-MAT`, quantity: 1, receiptId: pb.id })),
      await maLoi(() => c.mes.createSupplierLot({ supplierLotNumber: `${RUN}-loty`, materialCode: `${RUN}-MAT`, quantity: 1, receiptId: pa.id, factoryId: B.fid })),
    ];
    expect(l2).toEqual([NF, NF]);
    const ds = await c.mes.createLotDisposition({ lotNumber: `${RUN}-lotA`, supplierLotId: lot.id, disposition: "hold", quantity: 1 });
    expect(await so(sql`SELECT count(*)::int AS n FROM lot_disposition WHERE id = ${ds.id} AND "factoryId" = ${A.fid}`)).toBe(1);
    const lotB = await c.mesAdmin.createSupplierLot({ supplierLotNumber: `${RUN}-lotB`, materialCode: `${RUN}-MAT`, quantity: 1, receiptId: pb.id });
    expect(await maLoi(() => c.mes.createLotDisposition({ lotNumber: `${RUN}-lotB`, supplierLotId: lotB.id, disposition: "hold", quantity: 1 }))).toBe(NF);
    expect(await maLoi(() => c.mes.createLotDisposition({ lotNumber: `${RUN}-lotz`, disposition: "hold", quantity: 1 }))).toBe(NF); // không suy được nhà máy
  });
  it("đọc: người hẹp chỉ thấy phiếu / lô / quyết định của nhà máy A; toàn quyền thấy cả B", async () => {
    const pa = (await c.mes.listMaterialReceipts({ limit: 500 })).map((x) => x.receiptNumber).filter((x) => x.startsWith(RUN));
    expect(pa.sort()).toEqual([`${RUN}-ra`]);
    const lots = (await c.mes.listSupplierLots({ limit: 500 })).map((x) => x.supplierLotNumber).filter((x) => x.startsWith(RUN));
    expect(lots.sort()).toEqual([`${RUN}-lotA`]);
    const ds = (await c.mes.listDispositions({ limit: 500 })).map((x) => x.lotNumber).filter((x) => x.startsWith(RUN));
    expect(ds.sort()).toEqual([`${RUN}-lotA`]);
    const tat = (await c.mesAdmin.listSupplierLots({ limit: 500 })).map((x) => x.supplierLotNumber).filter((x) => x.startsWith(RUN));
    expect(tat.sort()).toEqual([`${RUN}-lotA`, `${RUN}-lotB`]);
  });
});

describe("quy tắc leo thang theo nhà máy (alertEscalationRouter + mqttAlertScheduler)", () => {
  const base = { escalateAfterMin: 60, notifyRoles: [] as never[], notifyUserIds: [] as number[], enabled: true };
  it("người hẹp: tạo quy tắc mặc định (NULL) / của nhà máy B ⇒ từ chối; tạo của A ⇒ được; sửa-xoá-bật-tắt quy tắc NULL hoặc của B ⇒ NOT_FOUND; list chỉ NULL + A", async () => {
    const mac = await c.escAdmin.create({ name: `${RUN}-null`, severity: "critical", alertType: "connection_lost", ...base });
    const ruaB = await c.escAdmin.create({ name: `${RUN}-rB`, severity: "critical", alertType: "connection_lost", ...base, factoryId: B.fid });
    const l = [
      await maLoi(() => c.esc.create({ name: `${RUN}-x1`, ...base })),
      await maLoi(() => c.esc.create({ name: `${RUN}-x2`, ...base, factoryId: B.fid })),
      await maLoi(() => c.esc.update({ id: mac.id, name: `${RUN}-hack` })),
      await maLoi(() => c.esc.toggle({ id: mac.id, enabled: false })),
      await maLoi(() => c.esc.delete({ id: mac.id })),
      await maLoi(() => c.esc.update({ id: ruaB.id, name: `${RUN}-hack` })),
      await maLoi(() => c.esc.delete({ id: ruaB.id })),
      await maLoi(() => c.esc.getById({ id: ruaB.id })),
    ];
    expect(l.map(ma)).toEqual(["FORBIDDEN", NF, NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM alert_escalation_rules WHERE name LIKE ${RUN + "-x%"} OR name = ${RUN + "-hack"}`)).toBe(0);
    const ruaA = await c.esc.create({ name: `${RUN}-rA`, severity: "critical", alertType: "connection_lost", ...base, factoryId: A.fid });
    expect(await maLoi(() => c.esc.toggle({ id: ruaA.id, enabled: true }))).toBeNull();
    const ten = (await c.esc.list()).map((x) => x.name).filter((x) => x.startsWith(RUN)).sort();
    expect(ten).toEqual([`${RUN}-null`, `${RUN}-rA`].sort());
  });
  it("bộ quét: (critical, connection_lost) của nhà máy A dùng quy tắc riêng của A, nhà máy B dùng quy tắc riêng của B (không dùng NULL); cặp khác của A vẫn rơi về NULL", async () => {
    const { sweepEscalations } = await import("../mqttAlertScheduler");
    const nguoiDung = await one(sql`SELECT id FROM alert_escalation_rules WHERE name = ${RUN + "-rA"}`);
    const quyTacB = await one(sql`SELECT id FROM alert_escalation_rules WHERE name = ${RUN + "-rB"}`);
    // cảnh báo warning của A: (warning, connection_lost) — A KHÔNG có quy tắc riêng cho cặp này; quy tắc NULL (critical,…) không khớp ⇒ thêm quy tắc NULL (warning, …)
    await dung(sql`INSERT INTO alert_escalation_rules (name, severity, "alertType", "escalateAfterMin", "notifyRoles", "notifyUserIds", enabled) VALUES (${RUN + "-nullW"}, 'warning', 'connection_lost', 60, '[]'::jsonb, '[]'::jsonb, true)`);
    const nullW = await one(sql`SELECT id FROM alert_escalation_rules WHERE name = ${RUN + "-nullW"}`);
    await dung(sql`INSERT INTO mqtt_connection_alerts ("profileId", "targetType", "targetId", "alertType", title, severity, "triggeredAt")
      VALUES (1, 'machine', ${A.mid}, 'connection_lost', ${RUN + "-alAw"}, 'warning', now() - interval '3 hours')`);
    const dang: Array<{ alert: string; ruleId: number }> = [];
    await sweepEscalations({
      notifyOwnerFn: async () => true,
      publishMqttFn: async (_t: string, payload: Record<string, any>) => {
        dang.push({ alert: String(payload.alertId), ruleId: Number(payload.ruleId) });
        return true as never;
      },
      createNotificationFn: async () => undefined as never,
      sendFcmFn: async () => undefined,
    } as never);
    const cA = `conn-${A.conn}`;
    const cB = `conn-${B.conn}`;
    const theoAlert = (a: string) => dang.filter((x) => x.alert === a).map((x) => x.ruleId);
    expect(theoAlert(cA)).toEqual([Number(nguoiDung.id)]); // (critical, X) của A ⇒ quy tắc RIÊNG của A, không phải NULL
    expect(theoAlert(cB)).toEqual([Number(quyTacB.id)]); // nhà máy B có quy tắc riêng cùng cặp ⇒ dùng của B, KHÔNG dùng NULL
    const aw = await one(sql`SELECT id FROM mqtt_connection_alerts WHERE title = ${RUN + "-alAw"}`);
    expect(theoAlert(`conn-${aw.id}`)).toEqual([Number(nullW.id)]); // (warning, X) của A ⇒ vẫn rơi về NULL
  });
});
