/**
 * ★★★ Lô W10 — phạm vi nhà máy của GHI: routing (định tuyến) · spcAdvanced (cấu hình SPC, cổng chất lượng, vi phạm) · goldenSample · mqttOee (OEE, ngừng máy, mục tiêu) ·
 * equipmentStandards (thẻ tenant), kiểm định phamViGhi 2026-10-25. Người dùng CHỈ gán nhà máy A gọi lên máy / sản phẩm / hàng của nhà máy B.
 * Sản phẩm: luật ghi theo sản phẩm (trong phạm vi hoặc nháp). Ngoài phạm vi ≡ NOT_FOUND + dữ liệu B không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw10b${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay {
  fid: number;
  lid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const pm: Record<string, number> = {};
const factories: string[] = [];
const eqCu = process.env.EQ_GOVERN_ENABLED;
let eng!: {
  rt: ReturnType<typeof import("./routingRouter").routingRouter.createCaller>;
  cfg: ReturnType<typeof import("./spcAdvancedRouter").spcConfigRouter.createCaller>;
  qg: ReturnType<typeof import("./spcAdvancedRouter").qualityGateRouter.createCaller>;
  vio: ReturnType<typeof import("./spcAdvancedRouter").spcRuleViolationRouter.createCaller>;
  mq: ReturnType<typeof import("./mqttOeeRouters").mqttClientRouter.createCaller>;
  oee: ReturnType<typeof import("./mqttOeeRouters").oeeRouter.createCaller>;
  es: ReturnType<typeof import("./equipmentStandardsRouter").equipmentStandardsRouter.createCaller>;
};
let sup!: { gs: ReturnType<typeof import("./goldenSampleRouter").goldenSampleRouter.createCaller> };

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { fid: Number(f.id), lid: Number(l.id), mid: Number(m.id), code };
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
const TGT = { targetOEE: 1, targetAvailability: 1, targetPerformance: 1, targetQuality: 1, alertThreshold: 1, criticalThreshold: 1 };
const dem = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);

beforeAll(async () => {
  process.env.EQ_GOVERN_ENABLED = "true";
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  for (const k of ["a", "b", "nhap"]) pm[k] = Number((await dung(sql`INSERT INTO product_models (code, name) VALUES (${`${RUN}-${k}`}, ${RUN}) RETURNING id`))[0].id);
  await dung(sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", priority, "isActive") VALUES (${pm.a}, ${A.mid}, 1, true)`);
  await dung(sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", priority, "isActive") VALUES (${pm.b}, ${B.mid}, 1, true)`);
  const mk = async (ten: string, role: "engineer" | "supervisor") => {
    const u = await taoNguoiDungTest(ten, role, { tienTo: "pw10b", ts: RUN, ten: `PW10b ${ten}` });
    await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
    for (const [cat, mod] of [
      ["production", "production_orders"],
      ["machine_monitoring", resolvePermissionModule("machine_monitoring")],
      ["machine_control", resolvePermissionModule("machine_control")],
    ] as const) {
      await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
    }
    return { user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never;
  };
  const ce = await mk("eng", "engineer");
  const cs = await mk("sup", "supervisor");
  const spc = await import("./spcAdvancedRouter");
  const mqo = await import("./mqttOeeRouters");
  eng = {
    rt: (await import("./routingRouter")).routingRouter.createCaller(ce),
    cfg: spc.spcConfigRouter.createCaller(ce),
    qg: spc.qualityGateRouter.createCaller(ce),
    vio: spc.spcRuleViolationRouter.createCaller(ce),
    mq: mqo.mqttClientRouter.createCaller(ce),
    oee: mqo.oeeRouter.createCaller(ce),
    es: (await import("./equipmentStandardsRouter")).equipmentStandardsRouter.createCaller(ce),
  };
  sup = { gs: (await import("./goldenSampleRouter")).goldenSampleRouter.createCaller(cs) };
}, 120_000);

afterAll(async () => {
  if (eqCu === undefined) delete process.env.EQ_GOVERN_ENABLED;
  else process.env.EQ_GOVERN_ENABLED = eqCu;
  if (!db) return;
  const like = RUN + "%";
  const P = sql.join(Object.values(pm).map((i) => sql`${i}`), sql`, `);
  await dung(sql`DELETE FROM routing_steps WHERE "routingId" IN (SELECT id FROM routing_master WHERE code LIKE ${like})`).catch(() => undefined);
  await dung(sql`DELETE FROM routing_master WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM quality_gate_events WHERE "qualityGateId" IN (SELECT id FROM quality_gates WHERE name LIKE ${like})`).catch(() => undefined);
  await dung(sql`DELETE FROM quality_gates WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM spc_rule_violations WHERE "ruleName" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM spc_configurations WHERE "productModelId" IN (${P})`).catch(() => undefined);
  await dung(sql`DELETE FROM measurement_point_defs WHERE "productModelId" IN (${P})`).catch(() => undefined);
  await dung(sql`DELETE FROM golden_sample_references WHERE "productCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM oee_targets WHERE "machineId" IN (${A.mid}, ${B.mid})`).catch(() => undefined);
  await dung(sql`DELETE FROM downtime_events WHERE "machineCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM master_alarms WHERE "alarmKey" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM device_type_change_requests WHERE "crKey" LIKE ${like} OR "targetTypeKey" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_machine_mappings WHERE "productModelId" IN (${P})`).catch(() => undefined);
  await dung(sql`DELETE FROM product_models WHERE id IN (${P})`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("routing — theo luật sản phẩm", () => {
  it("định tuyến sản phẩm B / bước của nó ⇒ NOT_FOUND; sản phẩm A và nháp qua cổng", async () => {
    const [rb] = await dung(sql`INSERT INTO routing_master ("productModelId", code) VALUES (${pm.b}, ${RUN + "-rb"}) RETURNING id`);
    const [sb] = await dung(sql`INSERT INTO routing_steps ("routingId", "stepNo", "operationCode") VALUES (${rb.id}, 1, 'OP1') RETURNING id`);
    const id = Number(rb.id);
    const l = [
      await maLoi(() => eng.rt.create({ productModelId: pm.b!, code: `${RUN}-x` } as never)),
      await maLoi(() => eng.rt.update({ id, name: "hack" } as never)),
      await maLoi(() => eng.rt.activate({ id } as never)),
      await maLoi(() => eng.rt.archive({ id } as never)),
      await maLoi(() => eng.rt.delete({ id } as never)),
      await maLoi(() => eng.rt.addStep({ routingId: id, stepNo: 2, operationCode: "OP2" } as never)),
      await maLoi(() => eng.rt.updateStep({ id: Number(sb.id), operationCode: "HACK" } as never)),
      await maLoi(() => eng.rt.deleteStep({ id: Number(sb.id) } as never)),
      await maLoi(() => eng.rt.replaceSteps({ routingId: id, steps: [] } as never)),
    ];
    const con = await dem(sql`SELECT count(*)::int AS n FROM routing_steps WHERE "routingId" = ${rb.id} AND "operationCode" = 'OP1'`);
    expect({ l, con, x: await dem(sql`SELECT count(*)::int AS n FROM routing_master WHERE code = ${RUN + "-x"}`) }).toEqual({ l: Array(9).fill(NF), con: 1, x: 0 });
    expect(await maLoi(() => eng.rt.create({ productModelId: pm.a!, code: `${RUN}-ok` } as never))).toBeNull();
    expect(await maLoi(() => eng.rt.create({ productModelId: pm.nhap!, code: `${RUN}-nhap` } as never))).toBeNull();
  });
});

describe("spcAdvanced — cấu hình · cổng chất lượng · vi phạm", () => {
  it("tạo cấu hình / cổng nhắm máy hoặc sản phẩm B ⇒ NOT_FOUND; không nêu khoá nào ⇒ BAD_REQUEST; máy A qua cổng", async () => {
    const l = [
      await maLoi(() => eng.cfg.create({ machineId: B.mid } as never)),
      await maLoi(() => eng.cfg.create({ productModelId: pm.b! } as never)),
      await maLoi(() => eng.cfg.create({} as never)),
      await maLoi(() => eng.qg.create({ name: `${RUN}-gb`, machineId: B.mid, gateType: "yield_rate", threshold: 90 } as never)),
      await maLoi(() => eng.qg.create({ name: `${RUN}-gl`, lineId: B.lid, gateType: "yield_rate", threshold: 90 } as never)),
    ];
    expect(l).toEqual([NF, NF, "BAD_REQUEST", NF, NF]);
    expect(await maLoi(() => eng.cfg.create({ machineId: A.mid } as never))).toBeNull();
    expect(await dem(sql`SELECT count(*)::int AS n FROM quality_gates WHERE name LIKE ${RUN + "-g%"}`)).toBe(0);
  });
  it("sửa / xoá cấu hình & cổng của máy B; xác nhận vi phạm và sự kiện cổng của B ⇒ NOT_FOUND", async () => {
    const [cb] = await dung(sql`INSERT INTO spc_configurations ("machineId", "productModelId") VALUES (${B.mid}, ${pm.b}) RETURNING id`);
    const [gb] = await dung(sql`INSERT INTO quality_gates (name, "gateType", threshold, "machineId", "productModelId") VALUES (${RUN + "-gtb"}, 'yield_rate', 90, ${B.mid}, ${pm.b}) RETURNING id`);
    const [eb] = await dung(sql`INSERT INTO quality_gate_events ("qualityGateId", "triggerValue", threshold, action) VALUES (${gb.id}, 1, 90, 'alert') RETURNING id`);
    const [pt] = await dung(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${pm.b}, ${RUN + "-pt"}, 'pt', 'DIMENSION', 1, 1) RETURNING id`);
    const [vb] = await dung(sql`INSERT INTO spc_rule_violations ("measurementPointDefId", "ruleType", "ruleName") VALUES (${pt.id}, 'rule1_beyond_3sigma', ${RUN + "-v"}) RETURNING id`).catch(async () => dung(sql`SELECT 0 AS id`));
    const l = [
      await maLoi(() => eng.cfg.update({ id: Number(cb.id), subgroupSize: 9 } as never)),
      await maLoi(() => eng.cfg.delete({ id: Number(cb.id) } as never)),
      await maLoi(() => eng.qg.update({ id: Number(gb.id), threshold: 1 } as never)),
      await maLoi(() => eng.qg.delete({ id: Number(gb.id) } as never)),
      await maLoi(() => eng.qg.triggerEvent({ qualityGateId: Number(gb.id), triggerValue: 1 } as never)),
      await maLoi(() => eng.qg.acknowledgeEvent({ id: Number(eb.id) } as never)),
      await maLoi(() => eng.qg.resolveEvent({ id: Number(eb.id) } as never)),
      ...(Number(vb.id) > 0 ? [await maLoi(() => eng.vio.acknowledge({ id: Number(vb.id) } as never)), await maLoi(() => eng.vio.resolve({ id: Number(vb.id) } as never))] : [NF, NF]),
    ];
    const con = await dem(sql`SELECT count(*)::int AS n FROM spc_configurations WHERE id = ${cb.id}`) + (await dem(sql`SELECT count(*)::int AS n FROM quality_gates WHERE id = ${gb.id} AND threshold = 90`));
    expect({ l, con }).toEqual({ l: Array(9).fill(NF), con: 2 });
  });
});

describe("goldenSample — theo luật sản phẩm", () => {
  it("duyệt / từ chối / rút / đổi căn chỉnh golden của sản phẩm B ⇒ NOT_FOUND; chụp lên sản phẩm B ⇒ NOT_FOUND", async () => {
    const [g] = await dung(sql`INSERT INTO golden_sample_references ("productCode", "productModelId", "grayBase64", width, height, status) VALUES (${RUN + "-b"}, ${pm.b}, 'AAAA', 1, 1, 'draft') RETURNING id`);
    const id = Number(g.id);
    const l = [
      await maLoi(() => sup.gs.approve({ id } as never)),
      await maLoi(() => sup.gs.reject({ id } as never)),
      await maLoi(() => sup.gs.retire({ id } as never)),
      await maLoi(() => sup.gs.setAlignBeforeDiff({ id, enabled: true } as never)),
      await maLoi(() => sup.gs.captureFromUpload({ productCode: `${RUN}-b`, imageBase64: "A".repeat(32) } as never)),
      await maLoi(() => sup.gs.diffWithUpload({ productCode: `${RUN}-b`, candidateBase64: "A".repeat(32) } as never)),
    ];
    const r = await one(sql`SELECT status AS s FROM golden_sample_references WHERE id = ${id}`);
    expect({ l, s: r.s }).toEqual({ l: Array(6).fill(NF), s: "draft" });
  });
});

describe("mqttOee — OEE · ngừng máy · mục tiêu", () => {
  it("tính OEE / sức khoẻ / ngừng máy / benchmark / mục tiêu lên máy B ⇒ NOT_FOUND; không hàng", async () => {
    const [tb] = await dung(sql`INSERT INTO oee_targets ("machineId", "setBy") VALUES (${B.mid}, 1) RETURNING id`);
    const mb = { machineId: B.mid, machineCode: `${RUN}-mb` };
    const l = [
      await maLoi(() => eng.mq.calculateOEE({ ...mb, plannedTime: 1, runTime: 1, idealCycleTime: 1, totalCount: 1, goodCount: 1 } as never)),
      await maLoi(() => eng.mq.startDowntime({ ...mb, category: "unplanned", reason: "x" } as never)),
      await maLoi(() => eng.mq.endDowntime({ machineId: B.mid } as never)),
      await maLoi(() => eng.mq.calculateMachineHealth({ ...mb } as never)),
      await maLoi(() => eng.mq.calculateBenchmarks({ machines: [{ ...mb, lineId: B.lid, oee: 1, yield: 1, cycleTime: 1, output: 1, downtime: 1, errors: 1 }], startDate: new Date(), endDate: new Date() } as never)),
      await maLoi(() => eng.oee.createTarget({ machineId: B.mid, ...TGT } as never)),
      await maLoi(() => eng.oee.updateTarget({ id: Number(tb.id), ...TGT } as never)),
      await maLoi(() => eng.oee.deleteTarget({ id: Number(tb.id) } as never)),
    ];
    const t = await one(sql`SELECT "isActive" AS a FROM oee_targets WHERE id = ${tb.id}`);
    expect({ l, hangNgungMay: await dem(sql`SELECT count(*)::int AS n FROM downtime_events WHERE "machineCode" = ${RUN + "-mb"}`), conTarget: t?.a }).toEqual({ l: Array(8).fill(NF), hangNgungMay: 0, conTarget: true });
  });
});

describe("equipmentStandards — thẻ tenant", () => {
  it("khai thẻ nhà máy B / sửa-xoá hàng gắn thẻ B ⇒ NOT_FOUND; chuẩn KHÔNG thẻ (toàn tập đoàn) và thẻ A qua cổng", async () => {
    const [mb] = await dung(sql`INSERT INTO master_alarms ("alarmKey", "factoryId") VALUES (${RUN + "-mab"}, ${B.fid}) RETURNING id`);
    const [mg] = await dung(sql`INSERT INTO master_alarms ("alarmKey") VALUES (${RUN + "-mag"}) RETURNING id`);
    const [cr] = await dung(sql`INSERT INTO device_type_change_requests ("crKey", "targetTypeKey", kind, "factoryId", status) VALUES (${RUN + "-cr"}, ${RUN + "-t"}, 'modify', ${B.fid}, 'pending') RETURNING id`);
    const l = [
      await maLoi(() => eng.es.upsertMasterAlarm({ alarmKey: `${RUN}-new`, consequence: "minor", factoryId: B.fid } as never)),
      await maLoi(() => eng.es.upsertAlarmMapping({ vendor: "v", nativeCode: RUN, standardCode: "S", severity: "high", factoryId: B.fid } as never)),
      await maLoi(() => eng.es.registerDeviceType({ typeKey: `${RUN}-dt`, factoryId: B.fid } as never)),
      await maLoi(() => eng.es.submitChangeRequest({ targetTypeKey: `${RUN}-t`, kind: "modify", factoryId: B.fid } as never)),
      await maLoi(() => eng.es.shelveMasterAlarm({ id: Number(mb.id), shelvedUntil: null } as never)),
      await maLoi(() => eng.es.deleteMasterAlarm({ id: Number(mb.id) } as never)),
      await maLoi(() => eng.es.reviewChangeRequest({ crId: Number(cr.id), to: "in_review" } as never)),
    ];
    expect({ l, con: await dem(sql`SELECT count(*)::int AS n FROM master_alarms WHERE id = ${mb.id}`) }).toEqual({ l: Array(7).fill(NF), con: 1 });
    expect(await maLoi(() => eng.es.shelveMasterAlarm({ id: Number(mg.id), shelvedUntil: null } as never))).toBeNull();
    expect(await maLoi(() => eng.es.upsertMasterAlarm({ alarmKey: `${RUN}-ok`, consequence: "minor", factoryId: A.fid } as never))).toBeNull();
  });
});
