/**
 * ★★★ Lô W11b — phạm vi nhà máy của GHI nhóm AI mang dữ liệu nhà máy: aiQualityGate (processInspection · reviewDecision) · aiFeedback (createSuggestion · submitFeedback ·
 * createTrainingBatch · exportTrainingBatch) · aiSegmentation.saveMask, kiểm định phamViGhi 2026-10-25. Người dùng CHỈ gán nhà máy A gọi lên lần kiểm tra của máy nhà máy B.
 * Ngoài phạm vi ≡ NOT_FOUND + dữ liệu B không đổi; lô huấn luyện / xuất chỉ gồm phản hồi của lần kiểm tra TRONG phạm vi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw11${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay {
  mid: number;
  code: string;
  insp: number;
}
let A!: NhaMay;
let B!: NhaMay;
const factories: string[] = [];
let uid = 0;
let c!: {
  qg: ReturnType<typeof import("./aiQualityGateRouter").aiQualityGateRouter.createCaller>;
  fb: ReturnType<typeof import("./aiFeedbackRouter").aiFeedbackRouter.createCaller>;
  seg: ReturnType<typeof import("./aiSegmentationRouter").aiSegmentationRouter.createCaller>;
};

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`,
  );
  const [i] = await dung(
    sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${m.id}, ${code + "-sn"}, 'OK', 'OK', now()) RETURNING id`,
  );
  factories.push(code);
  return { mid: Number(m.id), code, insp: Number(i.id) };
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
const sug = async (insp: number, ten: string) =>
  Number((await one(sql`INSERT INTO ai_suggestions ("inspectionId", "suggestionType", suggestion, confidence, "modelVersion", "modelName") VALUES (${insp}, 'DEFECT_CLASSIFICATION', ${RUN + ten}, 0.9, 'v', 'm') RETURNING id`)).id);
const fbk = async (sid: number) =>
  Number((await one(sql`INSERT INTO ai_feedback ("suggestionId", "feedbackType", "feedbackBy") VALUES (${sid}, 'CORRECT', ${uid}) RETURNING id`)).id);

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw11", ts: RUN, ten: "PW11 ua" });
  uid = u.id;
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never;
  c = {
    qg: (await import("./aiQualityGateRouter")).aiQualityGateRouter.createCaller(ctx),
    fb: (await import("./aiFeedbackRouter")).aiFeedbackRouter.createCaller(ctx),
    seg: (await import("./aiSegmentationRouter")).aiSegmentationRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM ai_feedback WHERE "suggestionId" IN (SELECT id FROM ai_suggestions WHERE suggestion LIKE ${like} OR "inspectionId" IN (${A?.insp ?? 0}, ${B?.insp ?? 0}))`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_training_batches WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_suggestions WHERE suggestion LIKE ${like} OR "inspectionId" IN (${A?.insp ?? 0}, ${B?.insp ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_quality_gate_results WHERE "inspectionId" IN (${A?.insp ?? 0}, ${B?.insp ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM defect_segmentations WHERE "classLabel" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${like}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("aiQualityGate / aiSegmentation — lần kiểm tra của máy nhà máy khác", () => {
  it("processInspection / reviewDecision / saveMask lên lần kiểm tra B ⇒ NOT_FOUND, không hàng", async () => {
    const [rb] = await dung(sql`INSERT INTO ai_quality_gate_results ("inspectionId", "configId", decision, confidence) VALUES (${B.insp}, 1, 'AUTO_OK', 0.9) RETURNING id`);
    const l = [
      await maLoi(() => c.qg.processInspection({ inspectionId: B.insp, imageKey: "k" } as never)),
      await maLoi(() => c.qg.reviewDecision({ resultId: Number(rb.id), reviewDecision: "NG" } as never)),
      await maLoi(() => c.seg.saveMask({ inspectionId: B.insp, maskData: { width: 10, height: 10, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, classLabel: `${RUN}-mb` } as never)),
    ];
    const r = await one(sql`SELECT "reviewDecision" AS d FROM ai_quality_gate_results WHERE id = ${rb.id}`);
    expect({ l, reviewed: r?.d ?? null, mask: Number((await one(sql`SELECT count(*)::int AS n FROM defect_segmentations WHERE "classLabel" = ${RUN + "-mb"}`)).n) }).toEqual({ l: [NF, NF, NF], reviewed: null, mask: 0 });
    // đối chứng: lần kiểm tra của A ĐỌC được (qua bước `product_inspections`, từng luôn "Inspection not found" vì `.rows?.[0]`) — dừng ở bước kế: chưa có cấu hình cổng chất lượng
    const loiA = await c.qg.processInspection({ inspectionId: A.insp, imageKey: "k" } as never).then(() => "ok", (e: Error) => e.message);
    expect(loiA).toMatch(/quality gate config/i);
  });
});

describe("aiFeedback — gợi ý · phản hồi · lô huấn luyện", () => {
  it("createSuggestion / submitFeedback lên lần kiểm tra B ⇒ NOT_FOUND; lần kiểm tra A ⇒ được", async () => {
    const sb = await sug(B.insp, "-sb");
    const l = [
      await maLoi(() => c.fb.createSuggestion({ inspectionId: B.insp, suggestionType: "DEFECT_CLASSIFICATION", suggestion: `${RUN}-x`, confidence: 0.5 } as never)),
      await maLoi(() => c.fb.submitFeedback({ suggestionId: sb, feedbackType: "CORRECT" } as never)),
    ];
    expect({ l, hang: Number((await one(sql`SELECT count(*)::int AS n FROM ai_suggestions WHERE suggestion = ${RUN + "-x"}`)).n), fb: Number((await one(sql`SELECT count(*)::int AS n FROM ai_feedback WHERE "suggestionId" = ${sb}`)).n) }).toEqual({ l: [NF, NF], hang: 0, fb: 0 });
    expect(await maLoi(() => c.fb.createSuggestion({ inspectionId: A.insp, suggestionType: "DEFECT_CLASSIFICATION", suggestion: `${RUN}-ok`, confidence: 0.5 } as never))).toBeNull();
  });
  it("createTrainingBatch gom CHỈ phản hồi của lần kiểm tra trong phạm vi và KHÔNG đánh dấu phản hồi nhà máy B; exportTrainingBatch chỉ xuất phần trong phạm vi", async () => {
    const fa = await fbk(await sug(A.insp, "-fa"));
    const fbB = await fbk(await sug(B.insp, "-fb"));
    const r = await c.fb.createTrainingBatch({ name: `${RUN}-batch`, feedbackIds: [fa, fbB] } as never);
    const daDung = async (id: number) => (await one(sql`SELECT "includedInTraining" AS i FROM ai_feedback WHERE id = ${id}`)).i;
    expect({ n: r.feedbackCount, a: await daDung(fa), b: await daDung(fbB) }).toEqual({ n: 1, a: true, b: false });
    // lô lẫn (do người toàn quyền tạo) — người hẹp phạm vi chỉ xuất phần của mình
    await dung(sql`UPDATE ai_feedback SET "trainingBatchId" = ${r.batchId}, "includedInTraining" = true WHERE id = ${fbB}`);
    const out = (await c.fb.exportTrainingBatch({ batchId: r.batchId } as never)) as any;
    const text = JSON.stringify(out);
    expect(text.includes(`${RUN}-fa`)).toBe(true);
    expect(text.includes(`${RUN}-fb`)).toBe(false);
  });
});

describe("lô W11b (tt) — cảnh báo thông minh · insight · hàng đợi gán nhãn · suy luận · triển khai edge", () => {
  it("smartAlert.acknowledge cảnh báo máy B · insight.setStatus insight máy B · activeLearning submitLabel/skipItem mục máy B · aiModel.runInference lần kiểm tra B ⇒ NOT_FOUND, không đổi", async () => {
    const ctx = { user: { id: uid, role: "engineer", name: "x", twoFactorEnabled: true } } as never;
    const sa = (await import("./aiSmartAlertRoutingRouter")).aiSmartAlertRoutingRouter.createCaller(ctx);
    const ins = (await import("./aiInsightRouter")).aiInsightRouter.createCaller(ctx);
    const al = (await import("./aiActiveLearningRouter")).aiActiveLearningRouter.createCaller(ctx);
    const am = (await import("./aiModelRouter")).aiModelRouter.createCaller(ctx);
    const [pa] = await dung(sql`INSERT INTO predictive_alerts ("alertType", title, description, "machineId") VALUES ('DEFECT_SPIKE', ${RUN + "-pa"}, 'd', ${B.mid}) RETURNING id`);
    const [mb] = await dung(sql`SELECT code FROM machines WHERE id = ${B.mid}`);
    const [ib] = await dung(sql`INSERT INTO ai_insights (source, title, body, "machineCode") VALUES ('t', ${RUN + "-in"}, 'b', ${mb.code}) RETURNING id`);
    const [qb] = await dung(sql`INSERT INTO ai_label_queue ("imageUrl", "modelId", "machineId") VALUES ('u', 1, ${B.mid}) RETURNING id`);
    const l = [
      await maLoi(() => sa.acknowledge({ alertId: Number(pa.id) } as never)),
      await maLoi(() => ins.setStatus({ id: Number(ib.id), status: "dismissed" } as never)),
      await maLoi(() => al.submitLabel({ queueId: Number(qb.id), humanLabel: "x" } as never)),
      await maLoi(() => al.skipItem({ queueId: Number(qb.id) } as never)),
      await maLoi(() => am.runInference({ modelId: 3, imageBase64: "AAAA", inspectionId: B.insp } as never)),
    ];
    expect({
      l,
      alert: (await one(sql`SELECT status AS s FROM predictive_alerts WHERE id = ${pa.id}`)).s,
      insight: (await one(sql`SELECT status AS s FROM ai_insights WHERE id = ${ib.id}`)).s,
    }).toEqual({ l: Array(5).fill(NF), alert: "ACTIVE", insight: "new" });
    await dung(sql`DELETE FROM predictive_alerts WHERE title = ${RUN + "-pa"}`);
    await dung(sql`DELETE FROM ai_insights WHERE title = ${RUN + "-in"}`);
    await dung(sql`DELETE FROM ai_label_queue WHERE id = ${qb.id}`);
  });
});
