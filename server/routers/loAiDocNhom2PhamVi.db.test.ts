/**
 * CỔNG CSDL THẬT — lô L6b-2 (rà bảo mật tRPC, 2026-10-25): ĐỌC nhóm AI còn lại — aiAnomaly (4) · aiCalibration (3) · aiInsight · aiRcaCopilot.latest · aiRobotAnomaly (2) · aiRouters (predictiveAlert list|get|stats, rootCause.list) ·
 * aiSmartAlertRouting (detectSpike · detectYieldDrop · stats) · aiThresholdAdvisor (3) · aiOrchestration (suggest|optimize) · aiSetupAdvisor.suggestSetup · aiAdvancedVision.explainHeatmap (theo imageKey).
 * Luật: dữ liệu theo máy / nhà máy / robot / lần kiểm tra ⇒ trong phạm vi; cấu hình-báo cáo cấp mô hình-sản phẩm (machineId NULL): không gắn sản phẩm ⇒ chung, gắn sản phẩm ⇒ luật sản phẩm L3; ngoài phạm vi ≡ không tồn tại.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";
import { anomalyModelCode } from "../services/aiAnomalyDetection";
import fs from "fs";
import path from "path";

process.env.AI_THRESHOLD_ADVISOR_ENABLED = "true";
process.env.AI_SETUP_ADVISOR_ENABLED = "true";

// advisor LLM: chỉ ghi lại danh sách máy được đưa vào (không gọi mô hình)
const ghi = vi.hoisted(() => ({ suggest: [] as number[][], optimize: [] as number[][], mach: [] as any[], dsId: [] as Array<number[] | undefined> }));
vi.mock("../services/orchestration/aiOrchestrationAdvisor", async (orig) => {
  const goc = await orig<typeof import("../services/orchestration/aiOrchestrationAdvisor")>();
  return {
    ...goc,
    suggestWorkflow: async (a: { machines: Array<{ id: number }>; machineIds?: number[] }) => { ghi.suggest.push(a.machines.map((m) => m.id)); ghi.dsId.push(a.machineIds); return { ok: true } as never; },
    optimizeWorkflow: async (a: { machines: Array<{ id: number }> }) => { ghi.optimize.push(a.machines.map((m) => m.id)); return { ok: true } as never; },
  };
});

const RUN = `l6h${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
type C = Record<string, any>;
let cA: C, cAdm: C, cRong: C;
let pmA = 0, pmB = 0, M = 0;
const ids: Record<string, number> = {};
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const mk = async (p: string, k: string) => ((await import(p))[k] as any).createCaller(ctx);
  return {
    an: await mk("./aiAnomalyRouter", "aiAnomalyRouter"),
    ca: await mk("./aiCalibrationRouter", "aiCalibrationRouter"),
    ins: await mk("./aiInsightRouter", "aiInsightRouter"),
    rca: await mk("./aiRcaCopilotRouter", "aiRcaCopilotRouter"),
    ra: await mk("./aiRobotAnomalyRouter", "aiRobotAnomalyRouter"),
    pa: await mk("./aiRouters", "predictiveAlertRouter"),
    rc: await mk("./aiRouters", "rootCauseRouter"),
    sa: await mk("./aiSmartAlertRoutingRouter", "aiSmartAlertRoutingRouter"),
    th: await mk("./aiThresholdAdvisorRouter", "aiThresholdAdvisorRouter"),
    or: await mk("./aiOrchestrationRouter", "aiOrchestrationRouter"),
    su: await mk("./aiSetupAdvisorRouter", "aiSetupAdvisorRouter"),
    av: await mk("./aiAdvancedVisionRouter", "aiAdvancedVisionRouter"),
  };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}
const idsOf = (rows: { id: number }[]) => rows.map((r) => r.id);
const j = (x: unknown) => JSON.stringify(x);
const uploads = process.env.LOCAL_STORAGE_DIR ? path.resolve(process.env.LOCAL_STORAGE_DIR) : path.join(process.cwd(), "uploads");

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6h", [["machine_monitoring", "machine_status"], ["machine_control", "machine_control"]], dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  const d = H.dung;
  // hai sản phẩm RIÊNG: pmA chỉ trên máy A, pmB chỉ trên máy B
  pmA = dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PMA", name: RUN } as never));
  pmB = dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PMB", name: RUN } as never));
  for (const [nm, pm] of [[H.A, pmA], [H.B, pmB]] as const) {
    await d(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode") VALUES (${nm.mid}, ${pm}, ${nm.code + "-P2"}, 'OK', 'OK', now(), ${nm.code})`);
  }
  M = (await d(sql`INSERT INTO ai_models (code, name, "modelType") VALUES (${RUN + "-M"}, ${RUN}, 'classification') RETURNING id`))[0].id;
  const mc = anomalyModelCode("heuristic", null);

  // ── anomaly: embedding có metadata.anomaly; hồ sơ; ngân hàng
  for (const [ten, nm] of [["eA", H.A], ["eB", H.B]] as const) {
    ids[ten] = (await d(sql`INSERT INTO ai_image_embeddings ("imageUrl", embedding, "embeddingDim", "modelCode", "machineId", metadata) VALUES (${RUN + ten + ".png"}, '[0.1]', 1, ${RUN}, ${nm.mid}, '{"anomaly":{"score":0.9,"threshold":0.5,"isAnomaly":true}}'::jsonb) RETURNING id`))[0].id;
  }
  const prof = async (ten: string, may: number | null, pm: number | null) =>
    (ids[ten] = (await d(sql`INSERT INTO ai_anomaly_profiles ("modelCode", threshold, source, "machineId", "productModelId") VALUES (${mc}, 0.5, 'test', ${may}, ${pm}) RETURNING id`))[0].id);
  await prof("pA", H.A.mid, null); await prof("pB", H.B.mid, null); await prof("pSpB", null, pmB); await prof("pChung", null, null);
  for (const [ten, nm] of [["bA", H.A], ["bB", H.B]] as const) {
    ids[ten] = (await d(sql`INSERT INTO ai_anomaly_memory_bank ("modelCode", embedding, "embeddingDim", source, "machineId") VALUES (${RUN}, '[0.1]', 1, 'test', ${nm.mid}) RETURNING id`))[0].id;
  }

  // ── calibration (rB là báo cáo MỚI NHẤT của mô hình để thử getLatest)
  const cal = async (ten: string, may: number | null, pm: number | null) =>
    (ids[ten] = (await d(sql`INSERT INTO ai_calibration_reports ("modelId", "periodStart", "periodEnd", "reliabilityBins", "machineId", "productModelId") VALUES (${M}, now() - interval '1 day', now(), '[]'::json, ${may}, ${pm}) RETURNING id`))[0].id);
  await cal("cChung", null, null); await cal("cSpB", null, pmB); await cal("cA", H.A.mid, null); await cal("cB", H.B.mid, null);

  // ── insight
  for (const [ten, code] of [["iA", H.A.code], ["iB", H.B.code], ["iNull", null]] as const) {
    ids[ten] = (await d(sql`INSERT INTO ai_insights (source, title, body, "machineCode") VALUES (${RUN}, ${RUN + ten}, 'x', ${code}) RETURNING id`))[0].id;
  }

  // ── root cause analysis
  const rca = async (ten: string, may: number | null, fac: number | null, by: number) =>
    (ids[ten] = (await d(sql`INSERT INTO root_cause_analysis ("analysisType", "startDate", "endDate", "dataPointsAnalyzed", "topFactors", "requestedBy", "machineId", "factoryId") VALUES ('DEFECT_ANALYSIS', now(), now(), 1, '[]'::json, ${by}, ${may}, ${fac}) RETURNING id`))[0].id);
  await rca("rA", H.A.mid, null, H.B.userId); await rca("rB", H.B.mid, null, H.A.userId); await rca("rMineA", null, null, H.A.userId); await rca("rMineB", null, null, H.B.userId);

  // ── robot + bất thường + rollback
  const robot = async (ten: string, nm: typeof H.A) =>
    (ids[ten] = (await d(sql`INSERT INTO robots (code, name, vendor, endpoint, "lineId", "stationId") VALUES (${RUN + ten}, ${ten}, 'sim', 'sim://x', ${nm.lid}, ${nm.sid}) RETURNING id`))[0].id);
  await robot("robA", H.A); await robot("robB", H.B);
  for (const [ten, rb] of [["raA", ids.robA], ["raB", ids.robB]] as const) {
    ids[ten] = (await d(sql`INSERT INTO robot_behavior_anomalies ("robotId", kind, score) VALUES (${rb}, 'x', 0.9) RETURNING id`))[0].id;
  }
  const rbk = async (ten: string, fac: number | null) =>
    (ids[ten] = (await d(sql`INSERT INTO model_rollback_events ("modelId", trigger, reason, "factoryId") VALUES (${M}, 'test', ${RUN}, ${fac}) RETURNING id`))[0].id);
  await rbk("rbA", H.A.fid); await rbk("rbB", H.B.fid); await rbk("rbChung", null);

  // ── cảnh báo dự đoán
  for (const [ten, may, fac] of [["paA", H.A.mid, H.A.fid], ["paB", H.B.mid, H.B.fid], ["paNull", null, null]] as const) {
    ids[ten] = (await d(sql`INSERT INTO predictive_alerts ("alertType", title, description, "machineId", "factoryId", severity, status) VALUES ('DEFECT_SPIKE', ${RUN + ten}, 'x', ${may}, ${fac}, 'HIGH', 'ACTIVE') RETURNING id`))[0].id;
  }

  // ── ngưỡng NG + điểm đo theo sản phẩm
  for (const [ten, nm] of [["ngA", H.A], ["ngB", H.B]] as const) {
    ids[ten] = (await d(sql`INSERT INTO mqtt_ng_rate_thresholds ("stationId", "machineId", name, "warningThreshold", "criticalThreshold") VALUES (${nm.sid}, ${nm.mid}, ${RUN + ten}, 5, 10) RETURNING id`))[0].id;
  }
  for (const [ten, pm, nm] of [["pdA", pmA, H.A], ["pdB", pmB, H.B]] as const) {
    ids[ten] = (await d(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "machineId") VALUES (${pm}, ${RUN + ten}, ${RUN + ten}, 'DIMENSION', 1, 1, ${nm.mid}) RETURNING id`))[0].id;
  }

  // ── ảnh: kết quả đo mang imageKey, mỗi nhà máy một ảnh; tệp thật cho ảnh A
  for (const [ten, nm] of [["imA", H.A], ["imB", H.B]] as const) {
    await d(sql`UPDATE measurement_results SET "imageKey" = ${RUN + ten + ".png"} WHERE id = ${nm.mr}`);
  }
  fs.mkdirSync(uploads, { recursive: true });
  const sharp = (await import("sharp")).default;
  await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toFile(path.join(uploads, RUN + "imA.png"));

  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  try { fs.unlinkSync(path.join(uploads, RUN + "imA.png")); } catch { /* không có */ }
  if (!H) return;
  const like = `'${RUN}%'`;
  for (const qy of [
    `DELETE FROM predictive_alerts WHERE title LIKE ${like}`,
    `DELETE FROM mqtt_ng_rate_thresholds WHERE name LIKE ${like}`,
    `DELETE FROM model_rollback_events WHERE reason LIKE ${like}`,
    `DELETE FROM robot_behavior_anomalies WHERE "robotId" IN (SELECT id FROM robots WHERE code LIKE ${like})`,
    `DELETE FROM robots WHERE code LIKE ${like}`,
    `DELETE FROM root_cause_analysis WHERE "requestedBy" IN (${H.A.userId}, ${H.B.userId})`,
    `DELETE FROM ai_insights WHERE source LIKE ${like}`,
    `DELETE FROM ai_calibration_reports WHERE "modelId" IN (SELECT id FROM ai_models WHERE code LIKE ${like})`,
    `DELETE FROM ai_anomaly_memory_bank WHERE "modelCode" LIKE ${like}`,
    `DELETE FROM ai_anomaly_profiles WHERE source = 'test' AND ("machineId" IN (${H.A.mid}, ${H.B.mid}) OR "productModelId" IN (${pmB}) OR ("machineId" IS NULL AND "productModelId" IS NULL AND id IN (${ids.pChung})))`,
    `DELETE FROM ai_image_embeddings WHERE "modelCode" LIKE ${like}`,
    `DELETE FROM measurement_point_defs WHERE code LIKE ${like}`,
    `DELETE FROM ai_models WHERE code LIKE ${like}`,
  ]) await qChuTest(qy).catch(() => undefined);
  await H.don();
});

describe("★★★ aiAnomaly", () => {
  it("latestForMachine / machineStatuses — máy B ngoài phạm vi ≡ trạng thái rỗng (giống máy không tồn tại)", async () => {
    const rong = j(await cA.an.latestForMachine({ machineId: 2147483000 }));
    expect(j(await cA.an.latestForMachine({ machineId: H.B.mid }))).toBe(rong);
    expect(j(await cAdm.an.latestForMachine({ machineId: H.B.mid }))).not.toBe(rong);
    expect(j(await cA.an.latestForMachine({ machineId: H.A.mid }))).not.toBe(rong);
    const st = await cA.an.machineStatuses({ machineIds: [H.A.mid, H.B.mid] });
    expect(j(st[H.B.mid])).toBe(rong);
    expect(j(st[H.A.mid])).not.toBe(rong);
    expect(j((await cAdm.an.machineStatuses({ machineIds: [H.B.mid] }))[H.B.mid])).not.toBe(rong);
  });
  it("getProfile / stats — hồ sơ theo máy; cấp sản phẩm theo luật sản phẩm; không gắn gì ⇒ chung", async () => {
    const ps = async (c: C, o: object) => ((await c.an.getProfile(o)).profiles as { id: number }[]).map((p) => p.id);
    expect(await ps(cA, { machineId: H.A.mid })).toContain(ids.pA);
    expect(await ps(cA, { machineId: H.B.mid })).not.toContain(ids.pB);
    expect(await ps(cAdm, { machineId: H.B.mid })).toContain(ids.pB);
    expect(await ps(cA, { productModelId: pmB })).not.toContain(ids.pSpB);
    expect(await ps(cAdm, { productModelId: pmB })).toContain(ids.pSpB);
    expect(await ps(cRong, {})).toContain(ids.pChung);
    const hoSo = ((await cA.an.stats({})).profiles as { id: number }[]).map((p) => p.id);
    expect(hoSo).toContain(ids.pA);
    expect(hoSo).toContain(ids.pChung);
    expect(hoSo).not.toContain(ids.pB);
    expect(hoSo).not.toContain(ids.pSpB);
    expect((await cA.an.stats({ machineId: H.B.mid })).totalVectors).toBe(0);
    expect((await cAdm.an.stats({ machineId: H.B.mid })).totalVectors).toBeGreaterThanOrEqual(1);
    expect((await cA.an.stats({ machineId: H.A.mid })).totalVectors).toBeGreaterThanOrEqual(1);
  });
});

describe("★★★ aiCalibration + aiInsight + RCA", () => {
  it("calibration list / get / getLatest", async () => {
    const a = idsOf(await cA.ca.listCalibration({ modelId: M }));
    expect(a).toEqual(expect.arrayContaining([ids.cA, ids.cChung]));
    expect(a).not.toContain(ids.cB);
    expect(a).not.toContain(ids.cSpB);
    expect(idsOf(await cAdm.ca.listCalibration({ modelId: M }))).toEqual(expect.arrayContaining([ids.cA, ids.cB, ids.cChung, ids.cSpB]));
    expect(await cA.ca.getCalibration({ id: ids.cB })).toBeNull();
    expect((await cA.ca.getCalibration({ id: ids.cA }))?.id).toBe(ids.cA);
    expect((await cA.ca.getLatestCalibration({ modelId: M }))?.id).toBe(ids.cA); // báo cáo mới nhất ĐƯỢC THẤY (cB mới hơn nhưng của nhà máy B)
    expect((await cAdm.ca.getLatestCalibration({ modelId: M }))?.id).toBe(ids.cB);
  });
  it("insight.list — A thấy insight máy A + chung, không thấy máy B", async () => {
    const a = idsOf(await cA.ins.list({ limit: 200 }));
    expect(a).toEqual(expect.arrayContaining([ids.iA, ids.iNull]));
    expect(a).not.toContain(ids.iB);
    expect(idsOf(await cAdm.ins.list({ limit: 200 }))).toEqual(expect.arrayContaining([ids.iA, ids.iB, ids.iNull]));
  });
  it("aiRcaCopilot.latest + rootCause.list — máy trong phạm vi, hoặc của chính người yêu cầu khi không gắn gì", async () => {
    const a = idsOf(await cA.rca.latest({ limit: 50 }));
    expect(a).toEqual(expect.arrayContaining([ids.rA, ids.rMineA]));
    expect(a).not.toContain(ids.rB);
    expect(a).not.toContain(ids.rMineB);
    const l = idsOf(await cA.rc.list({ limit: 100 }));
    expect(l).toEqual(expect.arrayContaining([ids.rA, ids.rMineA]));
    expect(l).not.toContain(ids.rB);
    expect(l).not.toContain(ids.rMineB);
    expect(idsOf(await cAdm.rc.list({ limit: 100 }))).toEqual(expect.arrayContaining([ids.rA, ids.rB]));
  });
});

describe("★★★ aiRobotAnomaly + predictiveAlert + smartAlert", () => {
  it("listAnomalies / rollbackHistory", async () => {
    const a = idsOf(await cA.ra.listAnomalies({ limit: 200 }));
    expect(a).toContain(ids.raA);
    expect(a).not.toContain(ids.raB);
    expect(idsOf(await cAdm.ra.listAnomalies({ limit: 200 }))).toEqual(expect.arrayContaining([ids.raA, ids.raB]));
    const rb = idsOf(await cA.ra.rollbackHistory({ modelId: M, limit: 100 }));
    expect(rb).toEqual(expect.arrayContaining([ids.rbA, ids.rbChung]));
    expect(rb).not.toContain(ids.rbB);
    expect(idsOf(await cAdm.ra.rollbackHistory({ modelId: M, limit: 100 }))).toContain(ids.rbB);
  });
  it("predictiveAlert list / get / stats", async () => {
    const a = (await cA.pa.list({ limit: 100 })).map((x: { id: number }) => x.id);
    expect(a).toContain(ids.paA);
    expect(a).not.toContain(ids.paB);
    expect(a).not.toContain(ids.paNull);
    const khong = await loi(() => cA.pa.get({ id: 2147483000 }));
    expect(await loi(() => cA.pa.get({ id: ids.paB }))).toBe(khong);
    expect(await loi(() => cA.pa.get({ id: ids.paA }))).toBeNull();
    expect((await cA.pa.stats()).total).toBe(1);
    expect((await cAdm.pa.stats()).total).toBeGreaterThanOrEqual(3);
    expect((await cRong.pa.stats()).total).toBe(0);
  });
  it("smartAlert detectSpike / detectYieldDrop / stats", async () => {
    expect(await loi(() => cA.sa.detectSpike({ machineId: H.B.mid }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:machine");
    expect(await loi(() => cA.sa.detectSpike({ machineId: H.A.mid }))).toBeNull();
    expect(await loi(() => cAdm.sa.detectSpike({ machineId: H.B.mid }))).toBeNull();
    expect(await loi(() => cA.sa.detectYieldDrop({ factoryId: H.B.fid }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:factory");
    expect(await loi(() => cA.sa.detectYieldDrop({ factoryId: H.A.fid }))).toBeNull();
    expect((await cA.sa.stats({ days: 7 })).totalAlerts).toBe(1);
    const sa = await cA.sa.stats({ days: 7 });
    expect(sa.byType).toEqual([{ type: "DEFECT_SPIKE", count: 1 }]);
    expect(sa.pendingCount).toBe(1);
    expect((await cAdm.sa.stats({ days: 7 })).totalAlerts).toBeGreaterThanOrEqual(3);
  });
});

describe("★★★ aiThresholdAdvisor + aiOrchestration + aiSetupAdvisor", () => {
  it("recommendForPoint / recommendNgThreshold / recommendInspectionParam — đối tượng nhà máy B ⇒ không tìm thấy", async () => {
    expect((await cA.th.recommendForPoint({ measurementPointId: ids.pdA })).ok).toBe(true);
    expect((await cA.th.recommendForPoint({ measurementPointId: ids.pdB })).ok).toBe(false);
    expect((await cAdm.th.recommendForPoint({ measurementPointId: ids.pdB })).ok).toBe(true);
    expect((await cA.th.recommendNgThreshold({ ngThresholdId: ids.ngA })).ok).toBe(true);
    expect((await cA.th.recommendNgThreshold({ ngThresholdId: ids.ngB })).ok).toBe(false);
    expect((await cAdm.th.recommendNgThreshold({ ngThresholdId: ids.ngB })).ok).toBe(true);
    expect((await cA.th.recommendInspectionParam({ ngThresholdId: ids.ngA })).ok).toBe(true);
    expect((await cA.th.recommendInspectionParam({ ngThresholdId: ids.ngB })).ok).toBe(false);
    expect((await cAdm.th.recommendInspectionParam({ ngThresholdId: ids.ngB })).ok).toBe(true);
  });
  it("orchestration suggestWorkflow / optimizeWorkflow — advisor chỉ nhận máy trong phạm vi", async () => {
    ghi.suggest.length = 0; ghi.optimize.length = 0;
    await cA.or.suggestWorkflow({ goal: "x", machineIds: [H.A.mid, H.B.mid], lang: "vi" });
    await cA.or.optimizeWorkflow({ workflow: {}, goal: "x", lang: "vi" });
    expect(ghi.suggest[0]).toContain(H.A.mid);
    expect(ghi.suggest[0]).not.toContain(H.B.mid);
    expect(ghi.dsId[0]).toEqual([H.A.mid]); // danh sách máy khai kèm cũng bị lọc về phạm vi
    expect(ghi.optimize[0]).toContain(H.A.mid);
    expect(ghi.optimize[0]).not.toContain(H.B.mid);
    await cAdm.or.optimizeWorkflow({ workflow: {}, goal: "x", lang: "vi" });
    expect(ghi.optimize[1]).toEqual(expect.arrayContaining([H.A.mid, H.B.mid]));
  });
  it("suggestSetup — mẫu chỉ chọn từ máy trong phạm vi (loại chính máy mình ⇒ không còn ứng viên ⇒ null)", async () => {
    const a = await cA.su.suggestSetup({ machineType: "AOI", targetMachineId: H.A.mid });
    expect(a.template).toBeNull();
    // không loại máy nào: ứng viên duy nhất trong phạm vi là máy A (admin không thử: duyệt cả hàng nghìn máy của CSDL test rất chậm)
    const a2 = await cA.su.suggestSetup({ machineType: "AOI" });
    expect(a2.template?.machine.id).toBe(H.A.mid);
  });
});

describe("★★★ aiAdvancedVision.explainHeatmap — ảnh theo imageKey", () => {
  it("ảnh của máy B ⇒ NOT_FOUND 'image'; ảnh của máy A và ảnh tạm temp/ qua cổng phạm vi", async () => {
    expect(await loi(() => cA.av.explainHeatmap({ imageKey: RUN + "imB.png" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
    expect(await loi(() => cA.av.explainHeatmap({ imageKey: "uploads/" + RUN + "imB.png" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
    expect(await loi(() => cA.av.explainHeatmap({ imageKey: "khong-ton-tai-" + RUN + ".png" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
    expect(await loi(() => cA.av.explainHeatmap({ imageKey: RUN + "imA.png" }))).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
    // ảnh tạm hợp lệ (tệp phẳng tmp_<ts>_<rand>.<ext>) qua cổng; mọi dạng traversal / mã hoá ≡ không tồn tại (lỗ "temp/../ảnh nhà máy B")
    expect(await loi(() => cA.av.explainHeatmap({ imageKey: "temp/tmp_123_abc.png" }))).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
    for (const k of ["temp/../" + RUN + "imB.png", "temp/%2e%2e/" + RUN + "imB.png", "temp" + String.fromCharCode(92) + ".." + String.fromCharCode(92) + RUN + "imB.png", "uploads/temp/../" + RUN + "imB.png", "/temp/../" + RUN + "imB.png", "temp//tmp_1_a.png", "temp/sub/tmp_1_a.png", "temp/khong-co-" + RUN + ".png", "temp/" + String.fromCharCode(0) + "x"]) {
      expect(await loi(() => cA.av.explainHeatmap({ imageKey: k })), k).toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
    }
    expect(await loi(() => cAdm.av.explainHeatmap({ imageKey: RUN + "imB.png" }))).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
    // ảnh chỉ tra ngược được qua ai_image_embeddings (không có trong kết quả đo)
    expect(await loi(() => cA.av.explainHeatmap({ imageKey: RUN + "eB.png" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
    expect(await loi(() => cA.av.explainHeatmap({ imageKey: RUN + "eA.png" }))).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:image");
  });
});
