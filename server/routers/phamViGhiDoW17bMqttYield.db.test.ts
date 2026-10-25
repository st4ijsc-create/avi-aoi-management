/**
 * ★★★ Lô W17b — LUẬT CẢNH BÁO MQTT + NGƯỠNG YIELD THEO NHÀ MÁY (mig 0426; chủ dự án quyết 2026-10-25), đọc · ghi · bộ đánh giá.
 * Giám sát viên CHỈ gán nhà máy A: luật / ngưỡng mặc định (factoryId NULL) và của nhà máy B ⇒ không thấy, không ghi (NOT_FOUND); tạo của A ⇒ được; loại luật không có số đo theo trạm
 * (BROKER_DISCONNECT) không đặt theo nhà máy; ngưỡng yield mỗi nhà máy ≤ 1 hàng/metric (lỗi i18n, không 23505 thô); bộ đánh giá: mỗi trạm đúng MỘT luật cho mỗi khoá.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

vi.mock("../_core/notification", () => ({ notifyOwner: async () => true }));
vi.mock("../services/emailService", () => ({ sendAlertEmail: async () => true }));

const RUN = `pw24${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const so = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);
const NF = "NOT_FOUND";
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const ma = String((e as { code?: string }).code ?? "LOI_LA");
    return ma;
  }
}
interface NhaMay {
  fid: number;
  code: string;
  tram: number;
}
let A!: NhaMay;
let B!: NhaMay;
let uA = 0;
let c!: {
  mqtt: ReturnType<typeof import("./mqttOeeRouters").mqttAlertRouter.createCaller>;
  mqttAdm: ReturnType<typeof import("./mqttOeeRouters").mqttAlertRouter.createCaller>;
  yl: ReturnType<typeof import("./alertRouters").yieldThresholdRouter.createCaller>;
  ylAdm: ReturnType<typeof import("./alertRouters").yieldThresholdRouter.createCaller>;
};
const mqttBase = { thresholdValue: 100, thresholdUnit: "ms", comparisonOperator: "GT" as const, timeWindowMinutes: 5, notifyOwner: false, notifyEmail: false, notifyMqtt: false, cooldownMinutes: 0 };

async function seed(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  return { fid: Number(f.id), code, tram: Number(s.id) };
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const u = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw24", ts: RUN, ten: "PW24 ua" });
  const adm = await taoNguoiDungTest("uadm", "admin", { tienTo: "pw24", ts: RUN, ten: "PW24 adm" });
  uA = u.id;
  A = await seed("a");
  B = await seed("b");
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const mod of ["machine_alerts", "settings_yield_thresholds"]) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'machine_monitoring', ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "supervisor", name: u.name, twoFactorEnabled: true } } as never;
  const ctxAdm = { user: { id: adm.id, role: "admin", name: adm.name, twoFactorEnabled: true } } as never;
  c = {
    mqtt: (await import("./mqttOeeRouters")).mqttAlertRouter.createCaller(ctx),
    mqttAdm: (await import("./mqttOeeRouters")).mqttAlertRouter.createCaller(ctxAdm),
    yl: (await import("./alertRouters")).yieldThresholdRouter.createCaller(ctx),
    ylAdm: (await import("./alertRouters")).yieldThresholdRouter.createCaller(ctxAdm),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM mqtt_message_logs WHERE topic LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_alert_history WHERE "ruleName" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_alert_rules WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM yield_threshold_history WHERE "changeReason" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM yield_alert_thresholds WHERE description LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM stations WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM production_lines WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM workshops WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("luật cảnh báo MQTT theo nhà máy (mqttAlertRouter)", () => {
  let ruleNull = 0;
  let ruleB = 0;
  let ruleA = 0;
  it("tạo: người hẹp không tạo được luật mặc định / của nhà máy B / loại broker theo nhà máy; tạo luật nhà máy A ⇒ được và mang factoryId A", async () => {
    const adm1 = await c.mqttAdm.create({ name: `${RUN}-null`, ruleType: "LATENCY_THRESHOLD", ...mqttBase });
    ruleNull = adm1!.id;
    ruleB = (await c.mqttAdm.create({ name: `${RUN}-B`, ruleType: "LATENCY_THRESHOLD", ...mqttBase, factoryId: B.fid }))!.id;
    const l = [
      await maLoi(() => c.mqtt.create({ name: `${RUN}-x1`, ruleType: "LATENCY_THRESHOLD", ...mqttBase })), // mặc định
      await maLoi(() => c.mqtt.create({ name: `${RUN}-x2`, ruleType: "LATENCY_THRESHOLD", ...mqttBase, factoryId: B.fid })), // nhà máy B
      await maLoi(() => c.mqtt.create({ name: `${RUN}-x3`, ruleType: "BROKER_DISCONNECT", ...mqttBase, factoryId: A.fid })), // loại không theo nhà máy
      await maLoi(() => c.mqtt.create({ name: `${RUN}-x4`, ruleType: "BROKER_DISCONNECT", ...mqttBase })), // người hẹp tạo luật broker mặc định
      await maLoi(() => c.mqttAdm.create({ name: `${RUN}-x5`, ruleType: "CLIENT_OFFLINE", ...mqttBase, factoryId: A.fid })), // ngay cả toàn quyền
    ];
    expect(l).toEqual(["FORBIDDEN", NF, "BAD_REQUEST", "FORBIDDEN", "BAD_REQUEST"]);
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_alert_rules WHERE name LIKE ${RUN + "-x%"}`)).toBe(0);
    ruleA = (await c.mqtt.create({ name: `${RUN}-A`, ruleType: "LATENCY_THRESHOLD", ...mqttBase, thresholdValue: 300, factoryId: A.fid }))!.id;
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_alert_rules WHERE id = ${ruleA} AND "factoryId" = ${A.fid}`)).toBe(1);
  });
  it("sửa / xoá / bật-tắt: luật mặc định hoặc của B ⇒ NOT_FOUND và không đổi; luật của A ⇒ được; list / getById chỉ NULL + A", async () => {
    const l = [
      await maLoi(() => c.mqtt.update({ id: ruleNull, name: `${RUN}-hack` })),
      await maLoi(() => c.mqtt.toggle({ id: ruleNull, isEnabled: false })),
      await maLoi(() => c.mqtt.delete({ id: ruleNull })),
      await maLoi(() => c.mqtt.update({ id: ruleB, name: `${RUN}-hack` })),
      await maLoi(() => c.mqtt.toggle({ id: ruleB, isEnabled: false })),
      await maLoi(() => c.mqtt.delete({ id: ruleB })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_alert_rules WHERE id IN (${ruleNull}, ${ruleB}) AND "isEnabled" = true AND name NOT LIKE '%hack'`)).toBe(2);
    expect(await maLoi(() => c.mqtt.toggle({ id: ruleA, isEnabled: true }))).toBeNull();
    const ten = (await c.mqtt.list()).map((r) => r.name).filter((x) => x.startsWith(RUN)).sort();
    expect(ten).toEqual([`${RUN}-A`, `${RUN}-null`].sort());
    expect(await c.mqtt.getById({ id: ruleB })).toBeNull();
    expect((await c.mqtt.getById({ id: ruleA }))?.id).toBe(ruleA);
  });
  it("lịch sử: người hẹp chỉ thấy bản ghi luật mặc định + luật nhà máy A; resolve bản ghi nhà máy B ⇒ NOT_FOUND", async () => {
    const hs = async (rid: number, f: number | null, ten: string) =>
      Number((await one(sql`INSERT INTO mqtt_alert_history ("ruleId", "ruleName", "ruleType", "triggeredValue", "thresholdValue", message, "factoryId") VALUES (${rid}, ${RUN + "-" + ten}, 'LATENCY_THRESHOLD', 1, 1, 'm', ${f}) RETURNING id`)).id);
    const hN = await hs(ruleNull, null, "hN");
    const hA = await hs(ruleA, A.fid, "hA");
    const hB = await hs(ruleB, B.fid, "hB");
    const thay = (await c.mqtt.history({ limit: 5000 })).map((x) => x.ruleName).filter((x) => x.startsWith(RUN)).sort();
    expect(thay).toEqual([`${RUN}-hA`, `${RUN}-hN`]);
    const chua = (await c.mqtt.unresolved()).map((x) => x.ruleName).filter((x) => x.startsWith(RUN)).sort();
    expect(chua).toEqual([`${RUN}-hA`, `${RUN}-hN`]);
    expect(await maLoi(() => c.mqtt.resolve({ id: hB }))).toBe(NF);
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_alert_history WHERE id = ${hB} AND "isResolved" = false`)).toBe(1);
    expect(await maLoi(() => c.mqtt.resolve({ id: hA }))).toBeNull();
    expect(uA).toBeGreaterThan(0);
    expect(hN).toBeGreaterThan(0);
  });
});

describe("alertEscalation.recentEscalations — theo nhà máy", () => {
  it("người hẹp chỉ thấy cảnh báo đã leo thang của luật mặc định (NULL) + nhà máy A; không thấy nhà máy B", async () => {
    const mk = async (f: number | null, ten: string) =>
      Number((await one(sql`INSERT INTO mqtt_alert_history ("ruleId", "ruleName", "ruleType", "triggeredValue", "thresholdValue", message, "factoryId", "escalatedAt") VALUES (1, ${RUN + "-esc" + ten}, 'LATENCY_THRESHOLD', 1, 1, 'm', ${f}, now()) RETURNING id`)).id);
    await mk(null, "N");
    await mk(A.fid, "A");
    await mk(B.fid, "B");
    const { alertEscalationRouter } = await import("./alertEscalationRouter");
    const u = alertEscalationRouter.createCaller({ user: { id: uA, role: "supervisor", name: "x", twoFactorEnabled: true } } as never);
    const thay = (await u.recentEscalations({ limit: 200 })).map((x) => x.title).filter((t) => t.startsWith(RUN)).sort();
    expect(thay).toEqual([`${RUN}-escA`, `${RUN}-escN`]);
  });
});

describe("bộ đánh giá MQTT — mỗi trạm đúng MỘT luật cho mỗi khoá", () => {
  it("★ nhà máy A có luật LATENCY riêng: trạm A theo luật A (avg 500 > 300 ⇒ kích, history mang factoryId A); luật mặc định chỉ thấy phần còn lại (B + chưa gán trạm: avg 50 ≤ 300 ⇒ không kích); không trạm nào bị đánh giá hai lần", async () => {
    const { evaluateAlertRules } = await import("../services/alertEvaluationService");
    const topic = `${RUN}-t`;
    const log = (tram: number | null, ms: number) =>
      dung(sql`INSERT INTO mqtt_message_logs ("messageType", topic, payload, "stationId", "deliveryStatus", "createdAt", "deliveredAt")
        VALUES ('NG_ALERT', ${topic}, '{}'::json, ${tram}, 'DELIVERED', now() - interval '1 minute', now() - interval '1 minute' + (${ms} * interval '1 millisecond'))`);
    await log(A.tram, 500);
    await log(A.tram, 500);
    await log(B.tram, 50);
    const mk = async (ten: string, f: number | null, thr: number) =>
      one(sql`INSERT INTO mqtt_alert_rules (name, "ruleType", "thresholdValue", "comparisonOperator", "timeWindowMinutes", "notifyOwner", "cooldownMinutes", "factoryId")
        VALUES (${RUN + "-e" + ten}, 'LATENCY_THRESHOLD', ${thr}, 'GT', 5, false, 0, ${f}) RETURNING *`);
    const rNull = await mk("null", null, 300);
    const rA = await mk("A", A.fid, 300);
    const toObj = (r: any) => ({ id: r.id, name: r.name, ruleType: r.ruleType, thresholdValue: r.thresholdValue, comparisonOperator: r.comparisonOperator, timeWindowMinutes: r.timeWindowMinutes, notifyOwner: false, notifyEmail: false, notifyMqtt: false, cooldownMinutes: 0, factoryId: r.factoryId, categoryId: r.categoryId });
    const kq = await evaluateAlertRules([toObj(rNull), toObj(rA)]);
    const theoId = new Map(kq.map((x) => [x.ruleId, x]));
    expect(theoId.get(rA.id)).toMatchObject({ triggered: true });
    expect(Number(theoId.get(rA.id)!.currentValue)).toBeCloseTo(500, 0); // chỉ trạm A (2 bản ghi × 500 ms)
    expect(theoId.get(rNull.id)!.triggered).toBe(false); // trạm A đã thuộc luật A — luật mặc định không thấy 500
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_alert_history WHERE "ruleId" = ${rA.id} AND "factoryId" = ${A.fid}`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_alert_history WHERE "ruleId" = ${rNull.id}`)).toBe(0);
    // ĐƯỜNG NHANH / hồi quy: chỉ luật mặc định (không nhà máy nào ghi đè) ⇒ thấy MỌI trạm — kết quả bằng đúng truy vấn cũ trên toàn bảng
    const goc = await one(sql`SELECT AVG(EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) * 1000.0) AS v FROM mqtt_message_logs WHERE "createdAt" >= now() - interval '5 minutes' AND "deliveredAt" IS NOT NULL AND "deliveryStatus" = 'DELIVERED'`);
    const chiNull = await evaluateAlertRules([toObj(rNull)]);
    expect(Number(chiNull[0].currentValue)).toBeGreaterThan(50);
    expect(Math.abs(Number(chiNull[0].currentValue) - Number(goc.v))).toBeLessThan(Math.max(5, Number(goc.v) * 0.2)); // tolerance: bản ghi từ test khác có thể xen vào giữa hai truy vấn
  });
});

describe("ngưỡng yield theo nhà máy (yieldThresholdRouter)", () => {
  const nguong = (extra: Record<string, unknown> = {}) => ({ metricType: "FPY" as const, warningThreshold: 95, criticalThreshold: 90, description: `${RUN}-d`, ...extra });
  let yNull = 0;
  let yB = 0;
  let yA = 0;
  it("tạo: người hẹp không tạo mặc định / nhà máy B; tạo A ⇒ được; trùng (A, metric) ⇒ lỗi i18n CONFLICT (không 23505 thô)", async () => {
    yNull = (await c.ylAdm.create(nguong({ metricType: "FPY" }))).id;
    yB = (await c.ylAdm.create(nguong({ metricType: "FPY", factoryId: B.fid }))).id;
    expect(await maLoi(() => c.yl.create(nguong({ metricType: "FY" })))).toBe("FORBIDDEN");
    expect(await maLoi(() => c.yl.create(nguong({ metricType: "FY", factoryId: B.fid })))).toBe(NF);
    yA = (await c.yl.create(nguong({ metricType: "FPY", factoryId: A.fid }))).id;
    expect(await so(sql`SELECT count(*)::int AS n FROM yield_alert_thresholds WHERE id = ${yA} AND "factoryId" = ${A.fid}`)).toBe(1);
    expect(await maLoi(() => c.yl.create(nguong({ metricType: "FPY", factoryId: A.fid })))).toBe("CONFLICT");
    expect(await so(sql`SELECT count(*)::int AS n FROM yield_alert_thresholds WHERE description = ${RUN + "-d"}`)).toBe(3);
  });
  it("sửa / xoá: ngưỡng mặc định hoặc của B ⇒ NOT_FOUND; của A ⇒ được; danh sách / getById / getEnabled chỉ NULL + A", async () => {
    const l = [
      await maLoi(() => c.yl.update({ id: yNull, warningThreshold: 1 })),
      await maLoi(() => c.yl.updateWithHistory({ id: yNull, warningThreshold: 1, changeReason: `${RUN}-h` })),
      await maLoi(() => c.yl.delete({ id: yNull })),
      await maLoi(() => c.yl.update({ id: yB, warningThreshold: 1 })),
      await maLoi(() => c.yl.updateWithHistory({ id: yB, warningThreshold: 1, changeReason: `${RUN}-h` })),
      await maLoi(() => c.yl.delete({ id: yB })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM yield_alert_thresholds WHERE id IN (${yNull}, ${yB}) AND "warningThreshold" = 95`)).toBe(2);
    expect(await so(sql`SELECT count(*)::int AS n FROM yield_threshold_history WHERE "changeReason" = ${RUN + "-h"}`)).toBe(0);
    expect(await maLoi(() => c.yl.updateWithHistory({ id: yA, warningThreshold: 96, changeReason: `${RUN}-h` }))).toBeNull();
    const ids = (await c.yl.list()).filter((r) => r.description === `${RUN}-d`).map((r) => r.id).sort();
    expect(ids).toEqual([yNull, yA].sort());
    expect((await c.yl.getEnabled()).filter((r) => r.description === `${RUN}-d`).map((r) => r.id).sort()).toEqual([yNull, yA].sort());
    expect(await c.yl.getById({ id: yB })).toBeNull();
    // lịch sử chỉ của ngưỡng thấy được
    const his = (await c.yl.getHistory({ limit: 1000 })).filter((h) => h.changeReason === `${RUN}-h`);
    expect(his.length).toBe(1);
    expect(his[0].thresholdId).toBe(yA);
  });
  it("ngưỡng HIỆU LỰC: nêu nhà máy A ⇒ hàng riêng của A; không nêu ⇒ mặc định; nhà máy B ⇒ NOT_FOUND", async () => {
    expect((await c.yl.getByType({ metricType: "FPY", factoryId: A.fid }))?.id).toBe(yA);
    expect((await c.yl.getByType({ metricType: "FPY" }))?.factoryId ?? null).toBeNull();
    expect(await maLoi(() => c.yl.getByType({ metricType: "FPY", factoryId: B.fid }))).toBe(NF);
    // metric mà A không ghi đè ⇒ rơi về mặc định
    const fy = await c.ylAdm.create(nguong({ metricType: "FY" }));
    expect((await c.yl.getByType({ metricType: "FY", factoryId: A.fid }))?.id).toBe(fy.id);
  });
  it("falseCallEscape (NTF): báo cáo thu về đúng một nhà máy ⇒ ưu tiên ngưỡng NTF riêng của nhà máy đó; nhiều/không máy ⇒ mặc định", async () => {
    const { getFalseCallEscapeKpi } = await import("../services/falseCallEscapeService");
    const mA = Number((await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${A.tram}, ${RUN + "mA"}, 'm', 'AOI', true) RETURNING id`)).id);
    const mB = Number((await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${B.tram}, ${RUN + "mB"}, 'm', 'AOI', true) RETURNING id`)).id);
    await c.ylAdm.create(nguong({ metricType: "NTF", warningThreshold: 11, criticalThreshold: 22 })); // mặc định
    await c.ylAdm.create(nguong({ metricType: "NTF", warningThreshold: 33, criticalThreshold: 44, factoryId: A.fid }));
    const ngay = { startDate: new Date(Date.now() - 86400_000), endDate: new Date() };
    expect((await getFalseCallEscapeKpi({ ...ngay, machineIds: [mA] })).threshold.warning).toBe(33);
    expect((await getFalseCallEscapeKpi({ ...ngay, machineIds: [mB] })).threshold.warning).toBe(11);
    expect((await getFalseCallEscapeKpi({ ...ngay, machineIds: [mA, mB] })).threshold.warning).toBe(11);
    expect((await getFalseCallEscapeKpi({ ...ngay })).threshold.warning).toBe(11);
    await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "m%"}`);
  });
});
