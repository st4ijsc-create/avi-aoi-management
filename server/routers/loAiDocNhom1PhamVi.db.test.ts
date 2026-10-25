/**
 * CỔNG CSDL THẬT — lô L6b-1 (rà bảo mật tRPC, 2026-10-25): ĐỌC nhóm AI theo MÁY / LẦN KIỂM TRA — aiActiveLearning (6) · aiFeedback (3) · aiModel (2) · aiQualityGate (4) · aiSegmentation.listMasks ·
 * aiAdvanced (edge ×5 + training.getDataStats + checkAutoRetrain) · aiEval.autoRetrainCheck.
 * Lỗ: người nhà máy A đọc hàng đợi gán nhãn, gợi ý + phản hồi, kết quả suy luận, cấu hình + kết quả cổng chất lượng AI, mặt nạ khuyết tật, triển khai edge và số liệu huấn luyện của MỌI nhà máy.
 * Luật: dữ liệu theo máy/lần kiểm tra ⇒ máy trong phạm vi (hàng không định vị được chỉ toàn quyền); cấu hình cấp mô hình-sản phẩm (machineId NULL): không gắn sản phẩm ⇒ chung, gắn sản phẩm ⇒ theo luật sản phẩm L3.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `l6g${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
type C = { al: any; fb: any; md: any; qg: any; sg: any; tr: any; ed: any; ev: any };
let cA: C, cAdm: C, cRong: C;
let M = 0, pmB = 0;
const ids: Record<string, number> = {};
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const mk = async (p: string, k: string) => ((await import(p))[k] as any).createCaller(ctx);
  return {
    al: await mk("./aiActiveLearningRouter", "aiActiveLearningRouter"),
    fb: await mk("./aiFeedbackRouter", "aiFeedbackRouter"),
    md: await mk("./aiModelRouter", "aiModelRouter"),
    qg: await mk("./aiQualityGateRouter", "aiQualityGateRouter"),
    sg: await mk("./aiSegmentationRouter", "aiSegmentationRouter"),
    tr: await mk("./aiAdvancedRouter", "trainingRouter"),
    ed: await mk("./aiAdvancedRouter", "edgeRouter"),
    ev: await mk("./aiEvalRouter", "aiEvalRouter"),
  };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}
const idsOf = (rows: { id: number }[]) => rows.map((r) => r.id);

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6g", [], dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  const d = H.dung;
  // sản phẩm RIÊNG của nhà máy B (chỉ chạy trên máy B)
  pmB = dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PMB", name: RUN } as never));
  await d(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode") VALUES (${H.B.mid}, ${pmB}, ${H.B.code + "-PB"}, 'OK', 'OK', now(), ${H.B.code})`);
  M = (await d(sql`INSERT INTO ai_models (code, name, "modelType") VALUES (${RUN + "-M"}, ${RUN}, 'classification') RETURNING id`))[0].id;
  // ── hàng đợi gán nhãn
  const q = async (ten: string, may: number | null, insp: number | null, st = "PENDING", pred: string | null = null, human: string | null = null) =>
    (ids[ten] = (await d(sql`INSERT INTO ai_label_queue ("imageUrl", "modelId", "machineId", "inspectionId", status, "predictedLabel", "humanLabel", priority, uncertainty) VALUES (${RUN + ten + ".jpg"}, ${M}, ${may}, ${insp}, ${st}::labelqueuestatusenum, ${pred}, ${human}, 5, 0.5) RETURNING id`))[0].id);
  await q("qA", H.A.mid, H.A.insp);
  await q("qB", H.B.mid, H.B.insp);
  await q("qNull", null, null);
  await q("lA", H.A.mid, H.A.insp, "LABELED", "NG", "NG");
  await q("lB", H.B.mid, H.B.insp, "LABELED", "NG", "OK");
  // embedding cho ảnh của hàng đợi (diversitySampling chỉ trả hàng có embedding)
  for (const ten of ["qA", "qB"]) {
    await d(sql`INSERT INTO ai_image_embeddings ("imageUrl", embedding, "embeddingDim", "modelCode") VALUES (${RUN + ten + ".jpg"}, '[0.1]', 1, ${RUN})`);
  }
  // ── gợi ý + phản hồi
  for (const [ten, nm] of [["sA", H.A], ["sB", H.B]] as const) {
    ids[ten] = (await d(sql`INSERT INTO ai_suggestions ("inspectionId", "suggestionType", suggestion, confidence, "modelVersion", "modelName", status) VALUES (${nm.insp}, 'DEFECT_CLASSIFICATION', ${RUN + ten}, 0.9, '1', ${RUN + "-M"}, 'PENDING') RETURNING id`))[0].id;
    ids["f" + ten[1]] = (await d(sql`INSERT INTO ai_feedback ("suggestionId", "feedbackType", "feedbackBy") VALUES (${ids[ten]}, ${ten === "sA" ? "CORRECT" : "INCORRECT"}::feedbacktypeenum, ${nm.userId}) RETURNING id`))[0].id;
  }
  // thêm một phản hồi ĐÚNG ở nhà máy B: nếu đếm "đúng" không theo phạm vi, độ chính xác của A vượt 100
  await d(sql`INSERT INTO ai_feedback ("suggestionId", "feedbackType", "feedbackBy") VALUES (${ids.sB}, 'CORRECT'::feedbacktypeenum, ${H.B.userId})`);
  // ── suy luận
  for (const [ten, nm] of [["iA", H.A], ["iB", H.B]] as const) {
    ids[ten] = (await d(sql`INSERT INTO inference_results ("modelId", "inspectionId", predictions, status) VALUES (${M}, ${nm.insp}, '[]'::json, 'COMPLETED') RETURNING id`))[0].id;
  }
  // ── cổng chất lượng: cấu hình theo máy, chung (không máy không sản phẩm), cấp sản phẩm B; kết quả
  const cfg = async (ten: string, may: number | null, pm: number | null) =>
    (ids[ten] = (await d(sql`INSERT INTO ai_quality_gate_configs (name, "modelId", "machineId", "productModelId") VALUES (${RUN + ten}, ${M}, ${may}, ${pm}) RETURNING id`))[0].id);
  await cfg("cfA", H.A.mid, null);
  await cfg("cfB", H.B.mid, null);
  await cfg("cfChung", null, null);
  await cfg("cfSpB", null, pmB);
  for (const [ten, nm, cf] of [["rA", H.A, ids.cfA], ["rB", H.B, ids.cfB]] as const) {
    ids[ten] = (await d(sql`INSERT INTO ai_quality_gate_results ("inspectionId", "configId", decision, confidence) VALUES (${nm.insp}, ${cf}, 'AUTO_OK', 0.9) RETURNING id`))[0].id;
  }
  // ── mặt nạ khuyết tật
  for (const [ten, insp] of [["dA", H.A.insp], ["dB", H.B.insp], ["dNull", null]] as const) {
    ids[ten] = (await d(sql`INSERT INTO defect_segmentations (source, "maskData", "classLabel", "inspectionId", "imageUrl") VALUES ('model', '{}'::json, 'x', ${insp}, ${RUN + ten + ".png"}) RETURNING id`))[0].id;
  }
  // ── edge
  const edge = async (ten: string, may: number | null) =>
    (ids[ten] = (await d(sql`INSERT INTO edge_deployments ("modelId", "deviceId", "machineId", status, "lastHeartbeatAt") VALUES (${M}, ${RUN + ten}, ${may}, 'ACTIVE', now() - interval '3 hours') RETURNING id`))[0].id);
  await edge("eA", H.A.mid);
  await edge("eB", H.B.mid);
  await edge("eNull", null);
  for (const ten of ["eA", "eB"]) {
    ids["s" + ten] = (await d(sql`INSERT INTO edge_inference_sync ("deploymentId", "modelId", predictions, "inferredAt", "deviceId") VALUES (${ids[ten]}, ${M}, '[]'::json, now(), ${RUN + ten}) RETURNING id`))[0].id;
  }
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  if (!H) return;
  const like = `'${RUN}%'`;
  for (const qy of [
    `DELETE FROM edge_inference_sync WHERE "deviceId" LIKE ${like}`,
    `DELETE FROM edge_deployments WHERE "deviceId" LIKE ${like}`,
    `DELETE FROM defect_segmentations WHERE "imageUrl" LIKE ${like}`,
    `DELETE FROM ai_quality_gate_results WHERE "configId" IN (SELECT id FROM ai_quality_gate_configs WHERE name LIKE ${like})`,
    `DELETE FROM ai_quality_gate_configs WHERE name LIKE ${like}`,
    `DELETE FROM inference_results WHERE "modelId" IN (SELECT id FROM ai_models WHERE code LIKE ${like})`,
    `DELETE FROM ai_feedback WHERE "suggestionId" IN (SELECT id FROM ai_suggestions WHERE "modelName" LIKE ${like})`,
    `DELETE FROM ai_suggestions WHERE "modelName" LIKE ${like}`,
    `DELETE FROM ai_label_queue WHERE "imageUrl" LIKE ${like}`,
    `DELETE FROM ai_models WHERE code LIKE ${like}`,
  ]) await qChuTest(qy).catch(() => undefined);
  await H.don();
});

describe("★★★ aiActiveLearning — hàng đợi gán nhãn", () => {
  it("getQueue / uncertaintySampling — A chỉ thấy hàng đợi máy A; hàng không định vị chỉ toàn quyền", async () => {
    const a = idsOf(await cA.al.getQueue({ limit: 200 }));
    expect(a).toContain(ids.qA);
    expect(a).not.toContain(ids.qB);
    expect(a).not.toContain(ids.qNull);
    const adm = idsOf(await cAdm.al.getQueue({ limit: 200, status: "PENDING" }));
    for (const k of ["qA", "qB", "qNull"]) expect(adm).toContain(ids[k]);
    expect(idsOf(await cA.al.uncertaintySampling({ limit: 100 }))).not.toContain(ids.qB);
    const dv = (await cA.al.diversitySampling({ limit: 100 })).map((x: { queueId: number }) => x.queueId);
    expect(dv).toContain(ids.qA);
    expect(dv).not.toContain(ids.qB);
    expect((await cAdm.al.diversitySampling({ limit: 100 })).map((x: { queueId: number }) => x.queueId)).toEqual(expect.arrayContaining([ids.qA, ids.qB]));
    expect(idsOf(await cRong.al.getQueue({ limit: 200 }))).not.toContain(ids.qA);
  });
  it("stats / checkRetrain / labelAccuracy — số của A không gồm nhà máy B", async () => {
    expect((await cA.al.stats({ modelId: M })).total).toBe(2); // qA + lA
    expect((await cAdm.al.stats({ modelId: M })).total).toBe(5);
    expect((await cRong.al.stats({ modelId: M })).total).toBe(0);
    expect((await cA.al.checkRetrain({ modelId: M, minNewLabels: 1 })).labeledCount).toBe(1);
    expect((await cAdm.al.checkRetrain({ modelId: M, minNewLabels: 1 })).labeledCount).toBe(2);
    const la = await cA.al.labelAccuracy({ modelId: M });
    expect(la.totalLabeled).toBe(1);
    expect(la.accuracy).toBe(1); // chỉ lA (đúng); lB (sai) của nhà máy B bị loại
    expect((await cAdm.al.labelAccuracy({ modelId: M })).totalLabeled).toBe(2);
  });
});

describe("★★★ aiFeedback — gợi ý + phản hồi theo lần kiểm tra", () => {
  it("getSuggestionsByInspection / getPendingSuggestions", async () => {
    expect(await cA.fb.getSuggestionsByInspection({ inspectionId: H.B.insp })).toEqual([]);
    expect(idsOf(await cAdm.fb.getSuggestionsByInspection({ inspectionId: H.B.insp }))).toContain(ids.sB);
    expect(idsOf(await cA.fb.getSuggestionsByInspection({ inspectionId: H.A.insp }))).toContain(ids.sA);
    const p = await cA.fb.getPendingSuggestions({ limit: 100 });
    expect(idsOf(p.suggestions)).toContain(ids.sA);
    expect(idsOf(p.suggestions)).not.toContain(ids.sB);
    expect(Number(p.total)).toBe(1);
    expect(Number((await cAdm.fb.getPendingSuggestions({ limit: 100 })).total)).toBeGreaterThanOrEqual(2);
  });
  it("getDashboardStats — chỉ gợi ý/phản hồi của máy A (kể cả recentFeedback)", async () => {
    const a = await cA.fb.getDashboardStats();
    expect(Number(a.totalSuggestions)).toBe(1);
    expect(Number(a.pendingReview)).toBe(1);
    expect(idsOf(a.recentFeedback)).toEqual([ids.fA]);
    expect(Number(a.reviewedToday)).toBe(1); // chỉ phản hồi của A (fB của nhà máy B bị loại)
    expect(a.accuracy).toBe(100); // 1/1 đúng — nếu lẫn fB (INCORRECT) sẽ < 100
    const adm = await cAdm.fb.getDashboardStats();
    expect(Number(adm.totalSuggestions)).toBeGreaterThanOrEqual(2);
    expect(idsOf(adm.recentFeedback)).toEqual(expect.arrayContaining([ids.fA, ids.fB]));
    expect(Number((await cRong.fb.getDashboardStats()).totalSuggestions)).toBe(0);
  });
});

describe("★★★ aiModel — kết quả suy luận", () => {
  it("getInferenceResults / getInferenceStats", async () => {
    const a = idsOf(await cA.md.getInferenceResults({ modelId: M }));
    expect(a).toContain(ids.iA);
    expect(a).not.toContain(ids.iB);
    expect(idsOf(await cAdm.md.getInferenceResults({ modelId: M }))).toEqual(expect.arrayContaining([ids.iA, ids.iB]));
    expect((await cA.md.getInferenceStats({ modelId: M })).totalInferences).toBe(1);
    expect((await cAdm.md.getInferenceStats({ modelId: M })).totalInferences).toBe(2);
  });
});

describe("★★★ aiQualityGate — cấu hình + kết quả", () => {
  it("listConfigs / getConfig — theo máy; cấu hình chung ai cũng thấy; cấp sản phẩm theo luật sản phẩm", async () => {
    const a = idsOf(await cA.qg.listConfigs({ limit: 200 }));
    expect(a).toContain(ids.cfA);
    expect(a).toContain(ids.cfChung);
    expect(a).not.toContain(ids.cfB);
    expect(a).not.toContain(ids.cfSpB);
    const adm = idsOf(await cAdm.qg.listConfigs({ limit: 200 }));
    for (const k of ["cfA", "cfB", "cfChung", "cfSpB"]) expect(adm).toContain(ids[k]);
    const khong = await loi(() => cA.qg.getConfig({ id: 2147483000 }));
    expect(await loi(() => cA.qg.getConfig({ id: ids.cfB }))).toBe(khong);
    expect(await loi(() => cA.qg.getConfig({ id: ids.cfSpB }))).toBe(khong);
    expect(await loi(() => cA.qg.getConfig({ id: ids.cfChung }))).toBeNull();
  });
  it("listResults / stats — chỉ kết quả của lần kiểm tra máy A (stats trước đây luôn 0 do đọc .rows)", async () => {
    expect(idsOf(await cA.qg.listResults({ limit: 200 }))).toEqual(expect.arrayContaining([ids.rA]));
    expect(idsOf(await cA.qg.listResults({ limit: 200 }))).not.toContain(ids.rB);
    expect((await cA.qg.stats({})).total).toBe(1);
    expect((await cAdm.qg.stats({})).total).toBeGreaterThanOrEqual(2);
    expect((await cRong.qg.stats({})).total).toBe(0);
  });
});

describe("★★★ aiSegmentation.listMasks", () => {
  it("mặt nạ của lần kiểm tra B và mặt nạ không định vị ẩn với A", async () => {
    const a = idsOf(await cA.sg.listMasks({ limit: 500 }));
    expect(a).toContain(ids.dA);
    expect(a).not.toContain(ids.dB);
    expect(a).not.toContain(ids.dNull);
    const adm = idsOf(await cAdm.sg.listMasks({ limit: 500 }));
    for (const k of ["dA", "dB", "dNull"]) expect(adm).toContain(ids[k]);
  });
});

describe("★★★ aiAdvanced — edge + số liệu huấn luyện; aiEval.autoRetrainCheck", () => {
  it("edge.list / getById / deviceDeployments / staleDeployments / inferenceResults", async () => {
    const a = idsOf(await cA.ed.list({ limit: 200 }));
    expect(a).toContain(ids.eA);
    expect(a).not.toContain(ids.eB);
    expect(a).not.toContain(ids.eNull);
    const adm = idsOf(await cAdm.ed.list({ limit: 200 }));
    for (const k of ["eA", "eB", "eNull"]) expect(adm).toContain(ids[k]);
    const khong = await loi(() => cA.ed.getById({ id: 2147483000 }));
    expect(await loi(() => cA.ed.getById({ id: ids.eB }))).toBe(khong);
    expect(await loi(() => cA.ed.getById({ id: ids.eA }))).toBeNull();
    expect(await cA.ed.deviceDeployments({ deviceId: RUN + "eB" })).toEqual([]);
    expect((await cAdm.ed.deviceDeployments({ deviceId: RUN + "eB" })).length).toBe(1);
    const st = idsOf(await cA.ed.staleDeployments({ thresholdMinutes: 60 }));
    expect(st).toContain(ids.eA);
    expect(st).not.toContain(ids.eB);
    const sy = idsOf(await cA.ed.inferenceResults({ limit: 200 }));
    expect(sy).toContain(ids.seA);
    expect(sy).not.toContain(ids.seB);
    expect(idsOf(await cAdm.ed.inferenceResults({ limit: 200 }))).toEqual(expect.arrayContaining([ids.seA, ids.seB]));
  });
  it("training.getDataStats / checkAutoRetrain / aiEval.autoRetrainCheck — số mẫu gán nhãn của A = 1, admin = 2", async () => {
    expect((await cA.tr.getDataStats({ modelId: M })).labeledCount).toBe(1);
    expect((await cAdm.tr.getDataStats({ modelId: M })).labeledCount).toBe(2);
    expect((await cA.tr.checkAutoRetrain({ modelId: M })).labeledCount).toBe(1);
    expect((await cAdm.tr.checkAutoRetrain({ modelId: M })).labeledCount).toBe(2);
    expect((await cA.ev.autoRetrainCheck({ modelId: M })).labeledCount).toBe(1);
    expect((await cRong.ev.autoRetrainCheck({ modelId: M })).labeledCount).toBe(0);
  });
});
