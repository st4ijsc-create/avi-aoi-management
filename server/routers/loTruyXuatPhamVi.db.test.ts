/**
 * CỔNG CSDL THẬT — lô L2 (rà bảo mật tRPC nhóm A + mutation cùng router, 2026-10-24): traceability · bom (feeder + truy vết linh kiện) · processResult · defectDisposition theo PHẠM VI người dùng.
 *
 * Lỗ: tài khoản gán nhà máy A (chỉ cần đăng nhập) truy xuất serial/lô, feeder, kết quả công đoạn (thống kê/SPC/telemetry/mart) và hàng đợi sửa chữa của MỌI nhà máy;
 * và ghi (tạo/chuyển trạng thái xử lý lỗi, nạp feeder, ghi kết quả công đoạn) lên thực thể nhà máy khác. Luật: dữ liệu thuộc MÁY (hoặc dây chuyền/WIP); máy ngoài phạm vi ≡ không tồn tại;
 * danh sách/tổng hợp chỉ tính máy trong phạm vi; một serial/lô DÙNG CHUNG giữa hai nhà máy chỉ lộ phần của máy trong phạm vi. Admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

process.env.PROCESS_ANALYTICS_ENABLED = "true";

const RUN = `l2${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const lay = async (q: ReturnType<typeof sql>) => (await dung(q))[0];

interface Nm { fid: number; mid: number; lid: number; code: string; serial: string; childSerial: string; insp: number; feeder: number; disp: number; userId: number }
let A!: Nm;
let B!: Nm;
const LOT = `LOT-${RUN}`;
const MA_LK = `LK-${RUN}`;
const LOT_B = `LOTB-${RUN}`; // lô CHỈ có hàng WIP ở nhà máy B, kèm xử lý cấp lô (không serial)
let supplierLotId = 0;
const STEP = `step-${RUN}`;
const uids: number[] = [];
let uA: any, uAdmin: any, uRong: any;
type C = { traceability: any; bom: any; processResult: any; defectDisposition: any };
let permInserted = false;

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
const khong = "NOT_FOUND:ENTITY_NOT_FOUND:";

async function seed(ten: string): Promise<Nm> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  const u = await taoNguoiDungTest(ten.toLowerCase(), "quality_inspector", { tienTo: "l2", ts: RUN, ten: `L2 ${ten}` });
  uids.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  const serial = `${RUN}-SN${ten}`;
  const childSerial = `${RUN}-CH${ten}`;
  // WIP: serial + lô DÙNG CHUNG; thêm hàng "con" trỏ cha là serial của nhà máy này
  await dung(sql`INSERT INTO wip_tracking ("serialNumber", "lotNumber", "lineId", "currentMachineId", status) VALUES (${serial}, ${LOT}, ${l.id}, ${m.id}, 'in_process')`);
  await dung(sql`INSERT INTO wip_tracking ("serialNumber", "lotNumber", "parentSerialNumber", "lineId", "currentMachineId", status) VALUES (${childSerial}, ${LOT}, ${serial}, ${l.id}, ${m.id}, 'in_process')`);
  await dung(sql`INSERT INTO lot_disposition ("lotNumber", "serialNumber", disposition, quantity, reason) VALUES (${LOT}, ${serial}, 'hold', 1, ${RUN + ten})`);
  if (ten === "B") {
    await dung(sql`INSERT INTO wip_tracking ("serialNumber", "lotNumber", "lineId", "currentMachineId", status) VALUES (${serial + "-lotb"}, ${LOT_B}, ${l.id}, ${m.id}, 'in_process')`);
    await dung(sql`INSERT INTO lot_disposition ("lotNumber", disposition, quantity, reason) VALUES (${LOT_B}, 'hold', 1, ${RUN + "lotb"})`);
  }
  await dung(sql`INSERT INTO component_installations ("serialNumber", "componentCode", "machineId", qty, "supplierLotId") VALUES (${serial}, ${MA_LK}, ${m.id}, 1, ${supplierLotId})`);
  const [fd] = await dung(sql`INSERT INTO feeder_materials ("machineId", "slotCode", "componentCode", "qtyOnFeeder", "reorderLevel", status) VALUES (${m.id}, 'S1', ${MA_LK}, 0, 5, 'active') RETURNING id`);
  // kết quả công đoạn: A 2 pass, B 3 fail (giá trị metric khác nhau)
  const nKq = ten === "A" ? 2 : 3;
  for (let i = 0; i < nKq; i++) {
    await dung(sql`INSERT INTO process_results ("serialNumber", "machineId", "machineType", "stepType", result, metrics, "measuredAt") VALUES (${serial}, ${m.id}, 'FEEDER', ${STEP}, ${ten === "A" ? "pass" : "fail"}, ${JSON.stringify({ v: ten === "A" ? 10 + i : 500 + i })}::jsonb, now())`);
  }
  await dung(sql`INSERT INTO process_result_daily (day, "machineId", "machineType", "stepType", pass, fail, warn, skip, total) VALUES (current_date, ${m.id}, 'FEEDER', ${STEP}, 1, 0, 0, 0, 1)`);
  await dung(sql`INSERT INTO ot_telemetry (ts, "machineId", protocol, metric, "numValue") VALUES (now(), ${m.id}, 'mqtt', ${"tk-" + RUN}, ${ten === "A" ? 21 : 99})`);
  // lần kiểm tra NG + xử lý lỗi mở
  const ng = (await dung(sql`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'overallresultenum' AND e.enumlabel = 'NG'`))[0].l;
  const [pi] = await dung(sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${m.id}, ${serial}, ${ng}, ${ng}, now()) RETURNING id`);
  const [dp] = await dung(sql`INSERT INTO defect_dispositions ("inspectionId", "serialNumber", disposition, status, "createdBy") VALUES (${pi.id}, ${serial}, 'repair', 'open', ${u.id}) RETURNING id`);
  return { fid: f.id, mid: m.id, lid: l.id, code, serial, childSerial, insp: pi.id, feeder: fd.id, disp: dp.id, userId: u.id };
}

const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [t, b, p, d] = await Promise.all([
    import("./traceabilityRouter").then((m) => m.traceabilityRouter.createCaller(ctx)),
    import("./bomRouter").then((m) => m.bomRouter.createCaller(ctx)),
    import("./processResultRouter").then((m) => m.processResultRouter.createCaller(ctx)),
    import("./defectDispositionRouter").then((m) => m.defectDispositionRouter.createCaller(ctx)),
  ]);
  return { traceability: t, bom: b, processResult: p, defectDisposition: d };
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const [sl] = await dung(sql`INSERT INTO supplier_lots ("supplierLotNumber", "materialCode", quantity) VALUES (${"SL-" + RUN}, ${MA_LK}, 10) RETURNING id`);
  supplierLotId = sl.id;
  A = await seed("A");
  B = await seed("B");
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "l2", ts: RUN, ten: "L2 ad" });
  const ur = await taoNguoiDungTest("ur", "quality_inspector", { tienTo: "l2", ts: RUN, ten: "L2 ur" });
  uids.push(ad.id, ur.id);
  // quyền mes_bom cho người dùng A (cổng RBAC của bomRouter); phạm vi nhà máy là lớp RIÊNG đang được thử
  for (const uid of [A.userId, ur.id]) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${uid}, 'production', 'mes_bom', true, true, true, true)`);
  }
  permInserted = true;
  uA = await caller({ id: A.userId, role: "quality_inspector", name: "L2 A" });
  uAdmin = await caller({ id: ad.id, role: "admin", name: "L2 ad" });
  uRong = await caller({ id: ur.id, role: "quality_inspector", name: "L2 ur" });
}, 180_000);

afterAll(async () => {
  if (!db) return;
  const k = (s: string) => s.replace(/'/g, "''");
  const like = `'${k(RUN)}%'`;
  const stmts = [
    `DELETE FROM defect_dispositions WHERE "serialNumber" LIKE ${like}`,
    `DELETE FROM audit_logs WHERE "entityName" LIKE ${like}`,
    `DELETE FROM process_result_daily WHERE "stepType" = '${k(STEP)}'`,
    `DELETE FROM process_results WHERE "stepType" = '${k(STEP)}'`,
    `DELETE FROM process_results WHERE "serialNumber" LIKE ${like}`,
    `DELETE FROM ot_telemetry WHERE metric = '${k("tk-" + RUN)}'`,
    `DELETE FROM component_installations WHERE "serialNumber" LIKE ${like}`,
    `DELETE FROM supplier_lots WHERE "supplierLotNumber" = '${k("SL-" + RUN)}'`,
    `DELETE FROM feeder_materials WHERE "componentCode" = '${k(MA_LK)}'`,
    `DELETE FROM lot_disposition WHERE "lotNumber" IN ('${k(LOT)}', '${k(LOT_B)}')`,
    `DELETE FROM wip_tracking WHERE "lotNumber" IN ('${k(LOT)}', '${k(LOT_B)}')`,
    `DELETE FROM genealogy_chain WHERE "serialNumber" LIKE ${like}`,
    `DELETE FROM product_inspections WHERE "serialNumber" LIKE ${like}`,
    `DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`,
    ...["machines", "stations", "production_lines", "workshops", "factories"].map((t) => `DELETE FROM ${t} WHERE code LIKE ${like}`),
  ];
  for (const s of stmts) { try { await qChu(s); } catch { /* dọn best-effort (bảng WORM/không có) */ } }
  void permInserted;
});

describe("★★★ traceability — serial / lô của nhà máy khác", () => {
  it("bySerial — serial của B ⇒ như chưa có dữ liệu; serial của A đủ; hàng WIP 'con' ở dây chuyền B không lộ qua cha của A", async () => {
    const u: C = uA;
    const b = await u.traceability.bySerial({ serialNumber: B.serial });
    expect(b).toMatchObject({ found: false, wip: [], downstream: [], components: [], upstream: [] });
    const a = await u.traceability.bySerial({ serialNumber: A.serial });
    expect(a.found).toBe(true);
    expect(a.wip.map((w: { serialNumber: string }) => w.serialNumber).sort()).toEqual([A.childSerial, A.serial].sort());
    expect(a.components.length).toBe(1);
    expect(a.downstream.length).toBe(1);
    // serial CHỈ có hàng WIP (không kiểm tra/lắp đặt) ở dây chuyền của A vẫn thấy được qua WIP
    const chi = await u.traceability.bySerial({ serialNumber: A.childSerial });
    expect(chi.found).toBe(true);
    expect(chi.wip.length).toBe(1);
    // linh kiện của serial A lắp tại MÁY B (hồ sơ chéo) không lộ cho A
    await dung(sql`INSERT INTO component_installations ("serialNumber", "componentCode", "machineId", qty) VALUES (${A.serial}, ${MA_LK + "-cheo"}, ${B.mid}, 1)`);
    expect((await u.traceability.bySerial({ serialNumber: A.serial })).components.map((c: { machineId: number }) => c.machineId)).toEqual([A.mid]);
    // con của B trỏ cha là serial B — hỏi bằng serial B không ra gì (trên), và một hàng con của B trỏ cha A không được lộ
    await dung(sql`INSERT INTO wip_tracking ("serialNumber", "lotNumber", "parentSerialNumber", "lineId", "currentMachineId", status) VALUES (${B.serial + "-x"}, ${LOT}, ${A.serial}, ${B.lid}, ${B.mid}, 'in_process')`);
    const a2 = await u.traceability.bySerial({ serialNumber: A.serial });
    expect(a2.wip.map((w: { serialNumber: string }) => w.serialNumber)).not.toContain(B.serial + "-x");
  });
  it("byLot — lô DÙNG CHUNG: chỉ hàng WIP và xử lý của nhà máy A; lô không có hàng nào trong phạm vi ⇒ rỗng", async () => {
    const u: C = uA;
    const r = await u.traceability.byLot({ lotNumber: LOT });
    expect(r.found).toBe(true);
    const sr = r.wip.map((w: { serialNumber: string }) => w.serialNumber);
    expect(sr).toContain(A.serial);
    expect(sr).not.toContain(B.serial);
    expect(sr).not.toContain(B.childSerial);
    expect(r.dispositions.map((d: { serialNumber: string }) => d.serialNumber)).toEqual([A.serial]);
    // lô chỉ có WIP ở B, có xử lý cấp lô (không serial) ⇒ A không thấy gì
    expect(await u.traceability.byLot({ lotNumber: LOT_B })).toMatchObject({ found: false, wip: [], dispositions: [] });
    expect((await uAdmin.traceability.byLot({ lotNumber: LOT_B })).dispositions.length).toBe(1);
    const rong: C = uRong;
    expect(await rong.traceability.byLot({ lotNumber: LOT })).toMatchObject({ found: false, wip: [], dispositions: [] });
    const ad: C = uAdmin;
    const all = await ad.traceability.byLot({ lotNumber: LOT });
    expect(all.wip.length).toBeGreaterThanOrEqual(4);
    expect(all.dispositions.length).toBeGreaterThanOrEqual(2);
  });
});

describe("★★★ bom — feeder + truy vết linh kiện", () => {
  it("listFeeders / feederReorderStatus — chỉ máy của A", async () => {
    const u: C = uA;
    expect(await u.bom.listFeeders({ machineId: B.mid })).toEqual([]);
    expect((await u.bom.listFeeders({ machineId: A.mid })).length).toBe(1);
    const re = await u.bom.feederReorderStatus({});
    const ms = re.map((x: { machineId: number }) => x.machineId);
    expect(ms).toContain(A.mid);
    expect(ms).not.toContain(B.mid);
    expect(await u.bom.feederReorderStatus({ machineId: B.mid })).toEqual([]);
  });
  it("traceForward / traceReverse — chỉ lắp đặt tại máy của A", async () => {
    const u: C = uA;
    expect((await u.bom.traceForward({ serialNumber: B.serial })).components).toEqual([]);
    expect((await u.bom.traceForward({ serialNumber: A.serial })).components.length).toBe(1);
    const rev = await u.bom.traceReverse({ componentCode: MA_LK });
    expect(rev.serials).toEqual([A.serial]);
    expect(rev.installations.every((i: { machineId: number }) => i.machineId === A.mid)).toBe(true);
    const revLo = await u.bom.traceReverse({ supplierLotId });
    expect(revLo.serials).toEqual([A.serial]);
    expect(revLo.installations.every((i: { machineId: number }) => i.machineId === A.mid)).toBe(true);
    const adm = await uAdmin.bom.traceReverse({ componentCode: MA_LK });
    expect(adm.serials.sort()).toEqual([A.serial, B.serial].sort());
  });
  it("GHI feeder — assignFeederMaterial máy B ⇒ NOT_FOUND machine; updateFeeder / loadFeeder feeder của B ⇒ null và B nguyên vẹn; của A cập nhật được", async () => {
    const u: C = uA;
    const truoc = (await dung(sql`SELECT count(*)::int AS n FROM feeder_materials WHERE "machineId" = ${B.mid}`))[0].n;
    expect(await chiTiet(() => u.bom.assignFeederMaterial({ machineId: B.mid, componentCode: MA_LK }))).toBe(khong + "machine");
    expect((await dung(sql`SELECT count(*)::int AS n FROM feeder_materials WHERE "machineId" = ${B.mid}`))[0].n).toBe(truoc);
    expect(await u.bom.updateFeeder({ id: B.feeder, reorderLevel: 77 })).toBeNull();
    expect(await u.bom.loadFeeder({ id: B.feeder, qtyOnFeeder: 123 })).toBeNull();
    const row = await lay(sql`SELECT "reorderLevel", "qtyOnFeeder" FROM feeder_materials WHERE id = ${B.feeder}`);
    expect(Number(row.reorderLevel)).toBe(5);
    expect(Number(row.qtyOnFeeder)).toBe(0);
    expect(await u.bom.updateFeeder({ id: A.feeder, reorderLevel: 9 })).not.toBeNull();
    expect(Number((await lay(sql`SELECT "reorderLevel" FROM feeder_materials WHERE id = ${A.feeder}`)).reorderLevel)).toBe(9);
    expect(await u.bom.loadFeeder({ id: A.feeder, qtyOnFeeder: 50 })).not.toBeNull();
  });
});

describe("★★★ processResult — kết quả công đoạn", () => {
  it("listBySerial — serial B ⇒ []; stats theo máy B ⇒ 0; stats tổng chỉ A", async () => {
    const u: C = uA;
    expect(await u.processResult.listBySerial({ serialNumber: B.serial })).toEqual([]);
    expect((await u.processResult.listBySerial({ serialNumber: A.serial })).length).toBe(2);
    expect(await u.processResult.stats({ machineId: B.mid, stepType: STEP })).toEqual({ pass: 0, fail: 0, warn: 0, skip: 0 });
    expect(await u.processResult.stats({ stepType: STEP })).toEqual({ pass: 2, fail: 0, warn: 0, skip: 0 });
    expect(await uAdmin.processResult.stats({ stepType: STEP })).toEqual({ pass: 2, fail: 3, warn: 0, skip: 0 });
  });
  it("metricSeries / spcChart — chỉ điểm đo của máy A (giá trị B = 500+ bị loại)", async () => {
    const u: C = uA;
    const s = await u.processResult.metricSeries({ stepType: STEP, metricKey: "v", bucket: "day" });
    expect(s.length).toBe(1);
    expect(s[0].samples).toBe(2);
    expect(s[0].value).toBeLessThan(100);
    const spc = await u.processResult.spcChart({ stepType: STEP, metricKey: "v" });
    expect(spc.n).toBe(2);
    expect(await u.processResult.metricSeries({ machineId: B.mid, stepType: STEP, metricKey: "v" })).toEqual([]);
  });
  it("fleetRollup / dailyRollup / envSeries — chỉ máy A", async () => {
    const u: C = uA;
    const dem = (await dung(sql`SELECT count(*)::int AS n FROM process_results WHERE "machineId" = ${A.mid} AND "machineType" = 'FEEDER' AND "measuredAt" >= now() - interval '7 days'`))[0].n;
    const fl = await u.processResult.fleetRollup({ machineType: "FEEDER" });
    expect(fl.reduce((a: number, r: { total: number }) => a + r.total, 0)).toBe(dem);
    const dl = await u.processResult.dailyRollup({ limit: 5000 });
    expect(dl.length).toBeGreaterThan(0);
    expect(dl.every((r: { machineId: number }) => r.machineId === A.mid)).toBe(true);
    expect(await u.processResult.dailyRollup({ machineId: B.mid })).toEqual([]);
    expect(await u.processResult.envSeries({ machineId: B.mid, tagKey: "tk-" + RUN })).toEqual([]);
    expect((await u.processResult.envSeries({ machineId: A.mid, tagKey: "tk-" + RUN })).length).toBe(1);
  });
  it("record — ghi kết quả cho máy B ⇒ NOT_FOUND machine, KHÔNG ghi; máy A ghi được", async () => {
    const u: C = uA;
    const sn = `${RUN}-REC`;
    expect(await chiTiet(() => u.processResult.record({ serialNumber: sn, machineId: B.mid, stepType: STEP, result: "pass" }))).toBe(khong + "machine");
    expect((await dung(sql`SELECT id FROM process_results WHERE "serialNumber" = ${sn}`)).length).toBe(0);
    expect(await chiTiet(() => u.processResult.record({ serialNumber: sn, machineId: A.mid, stepType: STEP, result: "pass" }))).toBeNull();
    expect((await dung(sql`SELECT id FROM process_results WHERE "serialNumber" = ${sn}`)).length).toBe(1);
  });
});

describe("★★★ defectDisposition — hàng đợi xử lý lỗi / sửa chữa", () => {
  it("đọc — chỉ xử lý của máy A: listByInspection / listBySerial / listOpen / countOpen / repairQueue / reInspectStatus / repairStats", async () => {
    const u: C = uA;
    expect(await u.defectDisposition.listByInspection({ inspectionId: B.insp })).toEqual([]);
    expect((await u.defectDisposition.listByInspection({ inspectionId: A.insp })).length).toBe(1);
    expect(await u.defectDisposition.listBySerial({ serial: B.serial })).toEqual([]);
    expect((await u.defectDisposition.listBySerial({ serial: A.serial })).length).toBe(1);
    const mo = await u.defectDisposition.listOpen({ limit: 500 });
    expect(mo.map((d: { id: number }) => d.id)).toContain(A.disp);
    expect(mo.map((d: { id: number }) => d.id)).not.toContain(B.disp);
    const demA = (await dung(sql`SELECT count(*)::int AS n FROM defect_dispositions d JOIN product_inspections i ON i.id = d."inspectionId" WHERE d.status <> 'closed' AND i."machineId" = ${A.mid}`))[0].n;
    expect(await u.defectDisposition.countOpen()).toBe(demA);
    const rq = await u.defectDisposition.repairQueue({ limit: 500 });
    expect(rq.map((d: { id: number }) => d.id)).toContain(A.disp);
    expect(rq.every((d: { machineId: number | null }) => d.machineId === A.mid)).toBe(true);
    expect(await u.defectDisposition.repairQueue({ machineId: B.mid })).toEqual([]);
    expect(await u.defectDisposition.reInspectStatus({ inspectionId: B.insp })).toEqual({ found: false, laterCount: 0 });
    // lần kiểm tra GỐC của B có một lần kiểm tra muộn hơn ở máy A cùng serial ⇒ A vẫn không được hỏi về inspection của B
    const ng0 = (await dung(sql`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'overallresultenum' AND e.enumlabel = 'NG'`))[0].l;
    await dung(sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${A.mid}, ${B.serial}, ${ng0}, ${ng0}, now() + interval '1 minute')`);
    expect(await u.defectDisposition.reInspectStatus({ inspectionId: B.insp })).toEqual({ found: false, laterCount: 0 });
    // cùng serial của A được kiểm lại ở máy B (muộn hơn) ⇒ A không thấy lần kiểm tra đó
    const ng = (await dung(sql`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'overallresultenum' AND e.enumlabel = 'NG'`))[0].l;
    await dung(sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${B.mid}, ${A.serial}, ${ng}, ${ng}, now() + interval '1 minute')`);
    expect(await u.defectDisposition.reInspectStatus({ inspectionId: A.insp })).toEqual({ found: false, laterCount: 0 });
    expect((await uAdmin.defectDisposition.reInspectStatus({ inspectionId: A.insp })).found).toBe(true);
    const st = await u.defectDisposition.repairStats();
    expect(Object.values(st.openByLane).reduce((a: number, b) => a + (b as number), 0)).toBe(demA);
    const ad = await uAdmin.defectDisposition.countOpen();
    expect(ad).toBeGreaterThanOrEqual(demA + 1);
  });
  it("GHI — create(B) / updateStatus(B) / transition(B) ⇒ NOT_FOUND, B nguyên vẹn; của A chạy được", async () => {
    const u: C = uA;
    const truoc = (await dung(sql`SELECT count(*)::int AS n FROM defect_dispositions WHERE "inspectionId" = ${B.insp}`))[0].n;
    expect((await chiTiet(() => u.defectDisposition.create({ inspectionId: B.insp, disposition: "repair" })))).toBe("NOT_FOUND:OPERATION_FAILED:manageDefectDisposition");
    expect((await dung(sql`SELECT count(*)::int AS n FROM defect_dispositions WHERE "inspectionId" = ${B.insp}`))[0].n).toBe(truoc);
    const inexist = await chiTiet(() => u.defectDisposition.updateStatus({ id: 2_000_000_000, status: "in_repair" }));
    expect(await chiTiet(() => u.defectDisposition.updateStatus({ id: B.disp, status: "in_repair" }))).toBe(inexist);
    expect(await chiTiet(() => u.defectDisposition.transition({ id: B.disp, status: "in_repair" }))).toBe(inexist);
    expect((await lay(sql`SELECT status FROM defect_dispositions WHERE id = ${B.disp}`)).status).toBe("open");
    expect(await chiTiet(() => u.defectDisposition.updateStatus({ id: A.disp, status: "in_repair" }))).toBeNull();
    expect(await chiTiet(() => u.defectDisposition.transition({ id: A.disp, status: "repaired" }))).toBeNull();
    expect((await lay(sql`SELECT status FROM defect_dispositions WHERE id = ${A.disp}`)).status).toBe("repaired");
    // tạo mới cho lần kiểm tra của A chạy được
    expect(await chiTiet(() => u.defectDisposition.create({ inspectionId: A.insp, disposition: "rework" }))).toBeNull();
  });
});

describe("đối chứng DƯƠNG (admin) + phạm vi rỗng", () => {
  it("admin thấy/ghi cả hai nhà máy", async () => {
    const ad: C = uAdmin;
    expect((await ad.traceability.bySerial({ serialNumber: B.serial })).found).toBe(true);
    expect((await ad.bom.listFeeders({ machineId: B.mid })).length).toBe(1);
    expect((await ad.processResult.listBySerial({ serialNumber: B.serial })).length).toBe(3);
    expect(await ad.defectDisposition.listByInspection({ inspectionId: B.insp })).toHaveLength(1);
    expect(await chiTiet(() => ad.defectDisposition.updateStatus({ id: B.disp, status: "in_repair" }))).toBeNull();
    expect(await chiTiet(() => ad.defectDisposition.updateStatus({ id: B.disp, status: "repaired" }))).toBeNull();
    // thống kê sửa chữa theo sự kiện kiểm toán: A chỉ đếm xử lý của mình (A.disp đã 'repaired' ở bài trước), không đếm B.disp vừa 'repaired'
    const stA = await (uA as C).defectDisposition.repairStats();
    expect(stA.repairedToday).toBe(1);
    expect(await chiTiet(() => ad.processResult.record({ serialNumber: `${RUN}-RECB`, machineId: B.mid, stepType: STEP, result: "pass" }))).toBeNull();
  });
  it("người dùng không gán nhà máy ⇒ rỗng / NOT_FOUND ở mọi nơi", async () => {
    const r: C = uRong;
    expect((await r.traceability.bySerial({ serialNumber: A.serial })).found).toBe(false);
    expect(await r.bom.listFeeders({ machineId: A.mid })).toEqual([]);
    expect((await r.bom.traceReverse({ componentCode: MA_LK })).serials).toEqual([]);
    expect(await r.processResult.listBySerial({ serialNumber: A.serial })).toEqual([]);
    expect(await r.defectDisposition.listOpen({ limit: 500 })).toEqual([]);
    expect(await r.defectDisposition.countOpen()).toBe(0);
    expect(await chiTiet(() => r.processResult.record({ serialNumber: `${RUN}-RR`, machineId: A.mid, stepType: STEP, result: "pass" }))).toBe(khong + "machine");
  });
});
