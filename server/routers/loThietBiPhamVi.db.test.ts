/**
 * CỔNG CSDL THẬT — lô L4 (rà bảo mật tRPC, 2026-10-25): ĐỌC của interlock + safety; ĐỌC + GHI của robot · vda5050 · equipment(+Integration) · predictiveMaintenance theo PHẠM VI người dùng.
 *
 * Lỗ: người dùng nhà máy A liệt kê/đọc luật interlock, vùng an toàn, hiệu chuẩn camera, phiên cộng tác, bảng phân công, robot (kể cả endpoint/connectionOptions), telemetry + job robot, danh sách máy
 * và năng lực thiết bị, lịch sử nạp công thức, dự báo bảo trì của MỌI nhà máy; gửi lệnh VDA5050 tới AGV nhà máy khác (ĐIỀU KHIỂN); thăm dò OPC-UA Euromap gắn máy nhà máy khác.
 * Luật: dữ liệu thuộc MÁY / robot (chuyền·trạm) / vị trí; ngoài phạm vi ≡ không tồn tại (NOT_FOUND hoặc rỗng/null theo dạng trả về cũ). Admin (toàn quyền) không đổi. `robot.consoleStop` KHÔNG đụng (miễn trừ L-7).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

process.env.SAFETY_ZONE_SW_ENABLED = "true";

const RUN = `l4${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const lay = async (q: ReturnType<typeof sql>) => (await dung(q))[0];

interface Nm { fid: number; mid: number; lid: number; sid: number; code: string; rule: number; ev: number; zone: number; cal: number; collab: number; asg: number; robot: number; agv: number; userId: number; recipeCode: string }
let A!: Nm;
let B!: Nm;
let ruleMoCoi = 0;
const uids: number[] = [];
let uA: any, uAdmin: any, uRong: any;
type C = { interlock: any; safety: any; robot: any; vda5050: any; equipment: any; equipmentIntegration: any; predictiveMaintenance: any };

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
  const u = await taoNguoiDungTest(ten.toLowerCase(), "supervisor", { tienTo: "l4", ts: RUN, ten: `L4 ${ten}` });
  uids.push(u.id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  // interlock: luật gắn máy + một sự kiện
  const [ru] = await dung(sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceType", "comparisonOperator", action) VALUES (${RUN + "-R" + ten}, 'machine', ${m.id}, 'ng_rate', 'gt', 'alert') RETURNING id`);
  const [ev] = await dung(sql`INSERT INTO interlock_events ("ruleId", status) VALUES (${ru.id}, 'fired') RETURNING id`);
  // robots: một AGV (vda5050) gắn chuyền + trạm
  const [rb] = await dung(sql`INSERT INTO robots (code, name, vendor, endpoint, kind, "lineId", "stationId", "isEnabled") VALUES (${code + "-RB"}, ${"rb" + ten}, 'sim', 'sim://x', 'arm', ${l.id}, ${s.id}, true) RETURNING id`);
  const [ag] = await dung(sql`INSERT INTO robots (code, name, vendor, endpoint, kind, "lineId", "stationId", "connectionOptions") VALUES (${code + "-AGV"}, ${"agv" + ten}, 'vda5050', 'mqtt://x', 'agv', ${l.id}, ${s.id}, '{}'::jsonb) RETURNING id`);
  await dung(sql`INSERT INTO robot_telemetry ("robotId", timestamp) VALUES (${rb.id}, now())`);
  await dung(sql`INSERT INTO robot_jobs ("robotId", "jobType", status) VALUES (${rb.id}, 'home', 'done')`);
  // safety
  const [zo] = await dung(sql`INSERT INTO safety_zones (code, name, "lineId", "stationId", "factoryId", "robotId") VALUES (${code + "-Z"}, ${"z" + ten}, ${l.id}, ${s.id}, ${f.id}, ${rb.id}) RETURNING id`);
  const [ca] = await dung(sql`INSERT INTO camera_calibrations ("cameraId", "lineId", "stationId", "factoryId", "robotId") VALUES (${code + "-CAM"}, ${l.id}, ${s.id}, ${f.id}, ${rb.id}) RETURNING id`);
  const [co] = await dung(sql`INSERT INTO collaboration_sessions ("robotDeviceId", "factoryId", phase) VALUES (${rb.id}, ${f.id}, 'human_prep') RETURNING id`);
  const [as] = await dung(sql`INSERT INTO operator_assignments ("operatorId", "lineId", "stationId", status, "factoryId") VALUES (${u.id}, ${l.id}, ${s.id}, 'active', ${f.id}) RETURNING id`);
  // lịch sử nạp công thức
  const recipeCode = `${RUN}-RC`;
  await dung(sql`INSERT INTO recipe_load_log (action, "recipeCode", "machineId") VALUES ('load', ${recipeCode}, ${m.id})`);
  return { fid: f.id, mid: m.id, lid: l.id, sid: s.id, code, rule: ru.id, ev: ev.id, zone: zo.id, cal: ca.id, collab: co.id, asg: as.id, robot: rb.id, agv: ag.id, userId: u.id, recipeCode };
}

const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [i, s, r, v, e, ei, p] = await Promise.all([
    import("./interlockRouter").then((m) => m.interlockRouter.createCaller(ctx)),
    import("./safetyRouter").then((m) => m.safetyRouter.createCaller(ctx)),
    import("./robotRouter").then((m) => m.robotRouter.createCaller(ctx)),
    import("./vda5050Router").then((m) => m.vda5050Router.createCaller(ctx)),
    import("./equipmentRouter").then((m) => m.equipmentRouter.createCaller(ctx)),
    import("./equipmentIntegrationRouter").then((m) => m.equipmentIntegrationRouter.createCaller(ctx)),
    import("./predictiveMaintenanceRouter").then((m) => m.predictiveMaintenanceRouter.createCaller(ctx)),
  ]);
  return { interlock: i, safety: s, robot: r, vda5050: v, equipment: e, equipmentIntegration: ei, predictiveMaintenance: p };
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seed("A");
  B = await seed("B");
  ruleMoCoi = (await dung(sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", action) VALUES (${RUN + "-R-MOCOI"}, 'machine', 'ng_rate', 'gt', 'alert') RETURNING id`))[0].id;
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo: "l4", ts: RUN, ten: "L4 ad" });
  const ur = await taoNguoiDungTest("ur", "supervisor", { tienTo: "l4", ts: RUN, ten: "L4 ur" });
  uids.push(ad.id, ur.id);
  for (const uid of [A.userId, B.userId, ur.id]) {
    for (const [mod, cat] of [["machine_status", "machine_monitoring"], ["machine_control", "machine_control"], ["interlock", "interlock"]] as const) {
      await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${uid}, ${cat}::permissioncategoryenum, ${mod}, true, true, true, true)`);
    }
  }
  uA = await caller({ id: A.userId, role: "supervisor", name: "L4 A" });
  uAdmin = await caller({ id: ad.id, role: "admin", name: "L4 ad" });
  uRong = await caller({ id: ur.id, role: "supervisor", name: "L4 ur" });
}, 240_000);

afterAll(async () => {
  if (!db) return;
  const k = (s: string) => s.replace(/'/g, "''");
  const like = `'${k(RUN)}%'`;
  const stmts = [
    `DELETE FROM interlock_events WHERE "ruleId" IN (SELECT id FROM interlock_rules WHERE name LIKE ${like})`,
    `DELETE FROM interlock_rules WHERE name LIKE ${like}`,
    `DELETE FROM robot_telemetry WHERE "robotId" IN (SELECT id FROM robots WHERE code LIKE ${like})`,
    `DELETE FROM robot_jobs WHERE "robotId" IN (SELECT id FROM robots WHERE code LIKE ${like})`,
    `DELETE FROM safety_zones WHERE code LIKE ${like}`,
    `DELETE FROM camera_calibrations WHERE "cameraId" LIKE ${like}`,
    `DELETE FROM collaboration_sessions WHERE "robotDeviceId" IN (SELECT id FROM robots WHERE code LIKE ${like})`,
    `DELETE FROM operator_assignments WHERE "factoryId" IN (SELECT id FROM factories WHERE code LIKE ${like})`,
    `DELETE FROM recipe_load_log WHERE "recipeCode" LIKE ${like}`,
    `DELETE FROM robots WHERE code LIKE ${like}`,
    `DELETE FROM audit_logs WHERE "entityName" LIKE ${like}`,
    `DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`,
    ...["machines", "stations", "production_lines", "workshops", "factories"].map((t) => `DELETE FROM ${t} WHERE code LIKE ${like}`),
  ];
  for (const s of stmts) { try { await qChu(s); } catch { /* dọn best-effort */ } }
});

describe("★★★ interlock — ĐỌC", () => {
  it("list / events — chỉ luật + sự kiện của A (luật không định vị và của B ẩn); get / testEvaluate luật B ⇒ NOT_FOUND", async () => {
    const u: C = uA;
    const ids = (await u.interlock.list()).map((r: { id: number }) => r.id);
    expect(ids).toContain(A.rule);
    for (const x of [B.rule, ruleMoCoi]) expect(ids).not.toContain(x);
    const ev = (await u.interlock.events({ limit: 500 })).map((e: { id: number }) => e.id);
    expect(ev).toContain(A.ev);
    expect(ev).not.toContain(B.ev);
    expect((await u.interlock.events({ ruleId: B.rule, limit: 500 })).length).toBe(0);
    expect(await chiTiet(() => u.interlock.get({ id: B.rule }))).toBe(khong + "interlockRule");
    expect(await chiTiet(() => u.interlock.get({ id: ruleMoCoi }))).toBe(khong + "interlockRule");
    expect(await chiTiet(() => u.interlock.get({ id: A.rule }))).toBeNull();
    expect(await chiTiet(() => u.interlock.testEvaluate({ id: B.rule, observedValue: 1 }))).toBe(khong + "interlockRule");
    expect(await chiTiet(() => u.interlock.testEvaluate({ id: A.rule, observedValue: 1 }))).toBeNull();
    const ad = (await uAdmin.interlock.list()).map((r: { id: number }) => r.id);
    expect(ad).toEqual(expect.arrayContaining([A.rule, B.rule, ruleMoCoi]));
  });
});

describe("★★★ safety — ĐỌC", () => {
  it("listZones / listCameraCalibrations / listCollaborations — chỉ của A", async () => {
    const u: C = uA;
    const z = (await u.safety.listZones()).map((x: { id: number }) => x.id);
    expect(z).toContain(A.zone);
    expect(z).not.toContain(B.zone);
    const c = (await u.safety.listCameraCalibrations()).map((x: { id: number }) => x.id);
    expect(c).toContain(A.cal);
    expect(c).not.toContain(B.cal);
    const cb = (await u.safety.listCollaborations({ limit: 500 })).map((x: { id: number }) => x.id);
    expect(cb).toContain(A.collab);
    expect(cb).not.toContain(B.collab);
    const zAd = (await uAdmin.safety.listZones()).map((x: { id: number }) => x.id);
    expect(zAd).toEqual(expect.arrayContaining([A.zone, B.zone]));
  });
  it("currentBoard — người vận hành + robot của A; B ẩn", async () => {
    const u: C = uA;
    const bang = await u.safety.currentBoard();
    const tx = JSON.stringify(bang);
    expect(tx).toContain(`"operatorId":${A.userId}`);
    expect(tx).not.toContain(`"operatorId":${B.userId}`);
    expect(tx).toContain(`"code":"${A.code}-RB"`);
    expect(tx).not.toContain(`"code":"${B.code}-RB"`);
    expect(JSON.stringify(await uAdmin.safety.currentBoard())).toContain(`"operatorId":${B.userId}`);
  });
  it("evaluateZones — robot mô phỏng mang id số của B ⇒ NOT_FOUND robot; của A chạy được", async () => {
    const u: C = uA;
    const robot = (id: number) => ({ id, x: 0, y: 0, z: 0 });
    expect(await chiTiet(() => u.safety.evaluateZones({ humans: [], robots: [robot(B.robot)] }))).toBe(khong + "robot");
    expect(await chiTiet(() => u.safety.evaluateZones({ humans: [], robots: [robot(A.robot)] }))).toBeNull();
    // vùng của B (áp cho MỌI robot, chặt hơn) KHÔNG được nạp vào lượt đánh giá của A: phản ứng phải đến từ vùng của A, không phải vùng B
    await dung(sql`UPDATE safety_zones SET enabled = false WHERE id IN (${A.zone}, ${B.zone})`); // vùng gieo không hình học làm nhiễu
    const hh = { aabb: { min: { x: -100, y: -100, z: 0 }, max: { x: 100, y: 100, z: 0 } } };
    const [zb] = await dung(sql`INSERT INTO safety_zones (code, name, "lineId", "stationId", "factoryId", "robotId", geometry, "speedReduceDistanceMm", "stopDistanceMm", "ratedStopDistanceMm", enabled) VALUES (${B.code + "-ZG"}, 'zb', ${B.lid}, ${B.sid}, ${B.fid}, ${A.robot}, ${JSON.stringify(hh)}::jsonb, 5000, 4000, 100, true) RETURNING id`);
    const [za] = await dung(sql`INSERT INTO safety_zones (code, name, "lineId", "stationId", "factoryId", "robotId", geometry, "speedReduceDistanceMm", "stopDistanceMm", "ratedStopDistanceMm", enabled) VALUES (${A.code + "-ZG"}, 'za', ${A.lid}, ${A.sid}, ${A.fid}, ${A.robot}, ${JSON.stringify(hh)}::jsonb, 5000, 50, 10, true) RETURNING id`);
    const kq = await u.safety.evaluateZones({ humans: [{ id: "h1", x: 50, y: 0, confidence: 1 }], robots: [robot(A.robot)] });
    const ids = (kq.reactions as Array<{ triggeringZoneId: number | null }>).map((r) => r.triggeringZoneId);
    expect(ids).toContain(za.id);
    expect(ids).not.toContain(zb.id);
    const kqAd = await uAdmin.safety.evaluateZones({ humans: [{ id: "h1", x: 50, y: 0, confidence: 1 }], robots: [robot(A.robot)] });
    expect((kqAd.reactions as Array<{ triggeringZoneId: number | null }>).map((r) => r.triggeringZoneId)).toContain(zb.id); // admin thấy cả vùng B (đối chứng DƯƠNG)
  });
});

describe("★★★ robot — ĐỌC", () => {
  it("list / get / telemetry / jobs / interlockPreview — chỉ robot của A; robot B ≡ không tồn tại", async () => {
    const u: C = uA;
    const ids = (await u.robot.list()).map((r: { id: number }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([A.robot, A.agv]));
    for (const x of [B.robot, B.agv]) expect(ids).not.toContain(x);
    expect(await u.robot.get({ id: B.robot })).toBeNull();
    expect((await u.robot.get({ id: A.robot }))?.id).toBe(A.robot);
    expect(await u.robot.telemetry({ robotId: B.robot })).toEqual([]);
    expect((await u.robot.telemetry({ robotId: A.robot })).length).toBe(1);
    expect(await u.robot.jobs({ robotId: B.robot })).toEqual([]);
    expect((await u.robot.jobs({ robotId: A.robot })).length).toBe(1);
    const prB = await u.robot.interlockPreview({ robotId: B.robot });
    const prKhong = await u.robot.interlockPreview({ robotId: 2_000_000_000 });
    expect(prB).toEqual(prKhong);
    // khoá cổng interlock của robot là machineId = robotId: một luật ĐÃ DUYỆT chặn máy B.mid KHÔNG được lộ cho A qua id robot trùng số (robot đó ngoài phạm vi / không có)
    const [luatChan] = await dung(sql`INSERT INTO interlock_rules (name, scope, "machineId", "targetMachineId", "sourceType", "sourceKey", "comparisonOperator", action, enabled, "approvedBy") VALUES (${RUN + "-R-CHAN"}, 'machine', ${B.mid}, ${B.mid}, 'telemetry_tag', 'tk-chan', 'gt', 'stop_line', true, ${A.userId}) RETURNING id`);
    expect((await u.robot.interlockPreview({ robotId: B.mid })).violations).toEqual([]);
    expect((await uAdmin.robot.interlockPreview({ robotId: B.mid })).violations.map((v: { ruleId: number }) => v.ruleId)).toContain(luatChan.id);
    await dung(sql`UPDATE interlock_rules SET enabled = false WHERE id = ${luatChan.id}`); // không ảnh hưởng các bài khác
    expect((await uAdmin.robot.list()).map((r: { id: number }) => r.id)).toEqual(expect.arrayContaining([A.robot, B.robot]));
    expect((await uRong.robot.list()).map((r: { id: number }) => r.id)).not.toContain(A.robot);
  });
});

describe("★★★ vda5050 — ĐỌC + ĐIỀU KHIỂN", () => {
  it("listAgvs — chỉ AGV của A; testConnection / status AGV B như không tồn tại", async () => {
    const u: C = uA;
    const ids = (await u.vda5050.listAgvs()).map((r: { id: number }) => r.id);
    expect(ids).toContain(A.agv);
    expect(ids).not.toContain(B.agv);
    expect(await u.vda5050.testConnection({ robotId: B.agv })).toEqual({ ok: false, error: "AGV robot not found (kind must be 'agv')" });
    const a = await u.vda5050.testConnection({ robotId: A.agv });
    expect(a.error).toContain("connectionOptions"); // AGV của A TÌM THẤY (lỗi cấu hình, không phải 'không tồn tại')
    expect((await u.vda5050.status({ robotId: B.agv })).adapterActive).toBe(false);
  });
  it("★★★ sendOrder tới AGV của B ⇒ NOT_FOUND robot, KHÔNG xây/gửi lệnh; AGV của A qua cổng phạm vi", async () => {
    const u: C = uA;
    const order = { nodes: [{ x: 0, y: 0 }] };
    expect(await chiTiet(() => u.vda5050.sendOrder({ robotId: B.agv, ...order }))).toBe(khong + "robot");
    const a = await u.vda5050.sendOrder({ robotId: A.agv, ...order });
    expect(a).toMatchObject({ ok: false, status: "rejected" }); // không có adapter hoạt động — nhưng ĐÃ qua cổng phạm vi
  });
});

describe("★★★ equipment / equipmentIntegration — ĐỌC", () => {
  it("listEquipment — chỉ máy của A; getCapabilities / getState máy B ⇒ NOT_FOUND machine", async () => {
    const u: C = uA;
    const ids = (await u.equipment.listEquipment({ limit: 1000 })).map((m: { machineId: number }) => m.machineId);
    expect(ids).toContain(A.mid);
    expect(ids).not.toContain(B.mid);
    expect((await u.equipment.listEquipment({ stationId: B.sid })).length).toBe(0);
    expect(await chiTiet(() => u.equipment.getCapabilities({ machineId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.equipment.getState({ machineId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.equipment.getCapabilities({ machineId: A.mid }))).toBeNull();
    expect(await chiTiet(() => u.equipment.getState({ machineId: A.mid }))).toBeNull();
    expect((await uAdmin.equipment.listEquipment({ stationId: B.sid })).length).toBe(1);
  });
  it("listLoadHistory / listCodeHistory — chỉ lượt nạp trên máy của A", async () => {
    const u: C = uA;
    expect(await u.equipmentIntegration.listLoadHistory({ machineId: B.mid })).toEqual([]);
    expect((await u.equipmentIntegration.listLoadHistory({ machineId: A.mid })).length).toBe(1);
    // cùng một mã công thức nạp trên cả hai nhà máy: chỉ thấy lượt của A
    await dung(sql`INSERT INTO recipe_load_log (action, "recipeCode", "machineId") VALUES ('load', ${A.recipeCode}, ${B.mid})`);
    const h = await u.equipmentIntegration.listCodeHistory({ code: A.recipeCode });
    expect(h.map((x: { machineId: number }) => x.machineId)).toEqual([A.mid]);
    expect((await uAdmin.equipmentIntegration.listCodeHistory({ code: A.recipeCode })).length).toBe(3); // A, B (gieo) + B (thêm)
  });
  it("★★★ euromapOpcuaSnapshot — máy / mã máy B ⇒ NOT_FOUND machine TRƯỚC khi mở OPC-UA; máy A qua cổng (lỗi thiếu cấu hình endpoint)", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.equipmentIntegration.euromapOpcuaSnapshot({ machineCode: B.code }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.equipmentIntegration.euromapOpcuaSnapshot({ machineCode: A.code, machineId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.equipmentIntegration.euromapOpcuaSnapshot({ machineCode: A.code, machineId: A.mid }))).toBe("BAD_REQUEST:FIELD_REQUIRED:euromapOpcuaEndpoint");
  });
});

describe("★★★ predictiveMaintenance — ĐỌC", () => {
  it("getMachineRisk / getReliabilityStats / getRulEstimate máy B ⇒ NOT_FOUND machine; listRulForecast chỉ máy A", async () => {
    const u: C = uA;
    expect(await chiTiet(() => u.predictiveMaintenance.getMachineRisk({ machineId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.predictiveMaintenance.getReliabilityStats({ machineId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.predictiveMaintenance.getRulEstimate({ machineId: B.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => u.predictiveMaintenance.getMachineRisk({ machineId: A.mid }))).toBeNull();
    expect(await chiTiet(() => u.predictiveMaintenance.getReliabilityStats({ machineId: A.mid }))).toBeNull();
    expect(await chiTiet(() => u.predictiveMaintenance.getRulEstimate({ machineId: A.mid }))).toBeNull();
    const ids = (await u.predictiveMaintenance.listRulForecast({ limit: 200 })).map((x: { machineId: number }) => x.machineId);
    expect(ids).toContain(A.mid);
    expect(ids).not.toContain(B.mid);
    expect((await uAdmin.predictiveMaintenance.listRulForecast({ limit: 200 })).length).toBeGreaterThanOrEqual(2);
  });
});

describe("đối chứng DƯƠNG (admin) + phạm vi rỗng", () => {
  it("người không gán nhà máy ⇒ rỗng / NOT_FOUND", async () => {
    const r: C = uRong;
    expect(await r.interlock.list()).toEqual([]);
    expect(await r.safety.listZones()).toEqual([]);
    expect(await r.robot.get({ id: A.robot })).toBeNull();
    expect(await chiTiet(() => r.equipment.getState({ machineId: A.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => r.predictiveMaintenance.getMachineRisk({ machineId: A.mid }))).toBe(khong + "machine");
    expect(await chiTiet(() => r.vda5050.sendOrder({ robotId: A.agv, nodes: [{ x: 0, y: 0 }] }))).toBe(khong + "robot");
  });
});
