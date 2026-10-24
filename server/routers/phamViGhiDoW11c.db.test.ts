/**
 * ★★★ Lô W11c (router) — phạm vi nhà máy của ba thủ tục "đề xuất HITL" qua cổng tool `kiemPhamViGhiTool`:
 *   aiVision.proposeDefect (propose_defect_from_vision) · aiRcaCopilot.applyTopFix (tool của gợi ý hàng đầu) · aiThresholdAdvisor.applyNgThreshold (adjust_ng_threshold).
 * Người dùng kỹ sư CHỈ gán nhà máy A (đủ quyền module) — đối chứng: thực thể A ⇒ đề xuất ĐƯỢC (có hàng ai_pending_actions);
 * thực thể B ⇒ bị từ chối ngay tại THỦ TỤC router, KHÔNG có hàng ai_pending_actions. Gỡ cổng ⇒ ca B đỏ (đột biến).
 * Bằng chứng cho MIEN_TRU_GHI "phạm vi qua cổng tool kiemPhamViGhiTool" của ba thủ tục này (dieu-phoi, 2026-10-25).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resolvePermissionModule } from "@shared/permissions";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw13${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
interface NhaMay {
  mid: number;
  code: string;
  insp: number;
  thr: number;
  rca: number;
}
let A!: NhaMay;
let B!: NhaMay;
let dc = 0;
let uid = 0;
const factories: string[] = [];
let c!: {
  vision: ReturnType<typeof import("./aiVisionRouter").aiVisionRouter.createCaller>;
  rca: ReturnType<typeof import("./aiRcaCopilotRouter").aiRcaCopilotRouter.createCaller>;
  adv: ReturnType<typeof import("./aiThresholdAdvisorRouter").aiThresholdAdvisorRouter.createCaller>;
};

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  const [i] = await dung(
    sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${m.id}, ${code + "-sn"}, 'OK', 'OK', now()) RETURNING id`,
  );
  const [t] = await dung(sql`INSERT INTO mqtt_ng_rate_thresholds ("stationId", "machineId", name, "warningThreshold", "criticalThreshold") VALUES (${s.id}, ${m.id}, ${code + "-thr"}, 5, 10) RETURNING id`);
  const hyp = {
    rcaHypotheses: [
      {
        recommendedFix: { kind: "WRITE", oneTap: true, tool: "create_maintenance_workorder", args: { machineId: Number(m.id), title: `${code}-wo`, priority: 3 } },
      },
    ],
  };
  const [r] = await dung(
    sql`INSERT INTO root_cause_analysis ("analysisType", "startDate", "endDate", "dataPointsAnalyzed", "topFactors", "requestedBy", "aiInsights") VALUES ('MACHINE_ANALYSIS', now(), now(), 1, '[]'::json, ${uid}, ${JSON.stringify(hyp)}::jsonb) RETURNING id`,
  );
  factories.push(code);
  return { mid: Number(m.id), code, insp: Number(i.id), thr: Number(t.id), rca: Number(r.id) };
}
const demHang = async (tool: string) => Number((await one(sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE "userId" = ${uid} AND tool = ${tool}`)).n);

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  await import("../services/aiLocalTools"); // đăng ký tool
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw13", ts: RUN, ten: "PW13 ua" });
  uid = u.id;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  dc = Number((await one(sql`INSERT INTO defect_catalog (code, name, severity, category) VALUES (${RUN + "-dc"}, ${RUN}, 'MINOR', 'OTHER') RETURNING id`)).id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [
    ["settings", "settings_alerts"],
    ["machine_monitoring", resolvePermissionModule("machine_monitoring")],
    ["settings", "history_correct"],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, false)`);
  }
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  c = {
    vision: (await import("./aiVisionRouter")).aiVisionRouter.createCaller(ctx),
    rca: (await import("./aiRcaCopilotRouter")).aiRcaCopilotRouter.createCaller(ctx),
    adv: (await import("./aiThresholdAdvisorRouter")).aiThresholdAdvisorRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${uid}`).catch(() => undefined);
  await dung(sql`DELETE FROM root_cause_analysis WHERE id IN (${A?.rca ?? 0}, ${B?.rca ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_ng_rate_thresholds WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM defect_catalog WHERE id = ${dc}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

type KetQua = { ok: boolean; reason?: string };

describe("aiThresholdAdvisor.applyNgThreshold → adjust_ng_threshold", () => {
  it("ngưỡng của nhà máy A ⇒ đề xuất được; ngưỡng nhà máy B ⇒ OUT_OF_SCOPE, không hàng", async () => {
    const truoc = await demHang("adjust_ng_threshold");
    const a = (await c.adv.applyNgThreshold({ ngThresholdId: A.thr, warningThreshold: 6 })) as KetQua;
    expect(a.ok).toBe(true);
    expect(await demHang("adjust_ng_threshold")).toBe(truoc + 1);
    const b = (await c.adv.applyNgThreshold({ ngThresholdId: B.thr, warningThreshold: 6 })) as KetQua;
    expect({ ok: b.ok, reason: b.reason }).toEqual({ ok: false, reason: "OUT_OF_SCOPE" });
    expect(await demHang("adjust_ng_threshold")).toBe(truoc + 1);
  });
});

describe("aiRcaCopilot.applyTopFix → tool của gợi ý hàng đầu (create_maintenance_workorder)", () => {
  it("phân tích gốc của máy A ⇒ đề xuất được; phân tích của máy B ⇒ OUT_OF_SCOPE, không hàng", async () => {
    const truoc = await demHang("create_maintenance_workorder");
    const a = (await c.rca.applyTopFix({ rcaId: A.rca })) as KetQua;
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(await demHang("create_maintenance_workorder")).toBe(truoc + 1);
    const b = (await c.rca.applyTopFix({ rcaId: B.rca })) as KetQua;
    expect({ ok: b.ok, reason: b.reason }).toEqual({ ok: false, reason: "OUT_OF_SCOPE" });
    expect(await demHang("create_maintenance_workorder")).toBe(truoc + 1);
  });
});

describe("aiVision.proposeDefect → propose_defect_from_vision", () => {
  it("lần kiểm tra A ⇒ đề xuất được; lần kiểm tra B ⇒ OUT_OF_SCOPE, không hàng; measurementResult của B ⇒ OUT_OF_SCOPE", async () => {
    const truoc = await demHang("propose_defect_from_vision");
    const [pt] = await dung(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES ((SELECT id FROM product_models LIMIT 1), ${RUN + "-pt"}, ${RUN}, 'DIMENSION', 1, 1) RETURNING id`);
    const a = (await c.vision.proposeDefect({ inspectionId: A.insp, pointDefId: Number(pt.id), defectCatalogId: dc } as never)) as KetQua;
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(await demHang("propose_defect_from_vision")).toBe(truoc + 1);
    const b = (await c.vision.proposeDefect({ inspectionId: B.insp, pointDefId: Number(pt.id), defectCatalogId: dc } as never)) as KetQua;
    expect({ ok: b.ok, reason: b.reason }).toEqual({ ok: false, reason: "OUT_OF_SCOPE" });
    const [mr] = await dung(sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result) VALUES (${B.insp}, ${Number(pt.id)}, 'NG') RETURNING id`);
    const b2 = (await c.vision.proposeDefect({ measurementResultId: Number(mr.id), defectCatalogId: dc } as never)) as KetQua;
    expect({ ok: b2.ok, reason: b2.reason }).toEqual({ ok: false, reason: "OUT_OF_SCOPE" });
    expect(await demHang("propose_defect_from_vision")).toBe(truoc + 1);
    await dung(sql`DELETE FROM measurement_results WHERE "pointDefId" = ${Number(pt.id)}`).catch(() => undefined);
    await dung(sql`DELETE FROM measurement_point_defs WHERE id = ${Number(pt.id)}`).catch(() => undefined);
  });
});
