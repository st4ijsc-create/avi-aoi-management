/**
 * ★★★ Lô W14c — phạm vi nhà máy của trainingBatchComments (bình luận · nhãn · gán nhãn của LÔ HUẤN LUYỆN AI), kiểm định phamViGhi 2026-10-25.
 * Lô chỉ có "nhà máy" qua phản hồi của nó (ai_feedback.trainingBatchId → gợi ý → lần kiểm tra → máy). Giám sát viên CHỈ gán nhà máy A:
 * lô có phản hồi của máy B / lô rỗng của người khác ⇒ NOT_FOUND; lô A và lô rỗng do chính họ tạo ⇒ được; sửa/xoá nhãn dùng chung ⇒ chỉ toàn quyền.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw19${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const so = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);
const NF = "NOT_FOUND";
const factories: string[] = [];
let uid = 0;
let khacId = 0;
let lo!: { A: string; B: string; rongKhac: string; rongToi: string };
let tag = 0;
let c!: ReturnType<typeof import("./trainingBatchCommentsRouter").trainingBatchCommentsRouter.createCaller>;

async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const ma = String((e as { code?: string }).code ?? "LOI_LA");
    return ma === NF ? ma : `${ma}:${(e as Error).message.slice(0, 100)}`;
  }
}

async function nhaMay(ten: string): Promise<number> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  factories.push(code);
  return Number(m.id);
}
async function loCoPhanHoi(batchId: string, machineId: number, ten: string): Promise<void> {
  const [i] = await dung(sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime") VALUES (${machineId}, ${RUN + ten + "-sn"}, 'OK', 'OK', now()) RETURNING id`);
  const [sg] = await dung(sql`INSERT INTO ai_suggestions ("inspectionId", "suggestionType", suggestion, confidence, "modelVersion", "modelName") VALUES (${i.id}, 'DEFECT_CLASSIFICATION', ${RUN + ten}, 0.9, 'v', 'm') RETURNING id`);
  await dung(sql`INSERT INTO ai_feedback ("suggestionId", "feedbackType", "feedbackBy", "trainingBatchId", "includedInTraining") VALUES (${sg.id}, 'CORRECT', ${uid}, ${batchId}, true)`);
}
async function loMoi(batchId: string, createdBy: number): Promise<void> {
  await dung(sql`INSERT INTO ai_training_batches ("batchId", name, "createdBy") VALUES (${batchId}, ${batchId}, ${createdBy})`);
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const u = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw19", ts: RUN, ten: "PW19 ua" });
  const khac = await taoNguoiDungTest("ukhac", "supervisor", { tienTo: "pw19", ts: RUN, ten: "PW19 khac" });
  uid = u.id;
  khacId = khac.id;
  const mA = await nhaMay("a");
  const mB = await nhaMay("b");
  lo = { A: `${RUN}-loA`, B: `${RUN}-loB`, rongKhac: `${RUN}-loRK`, rongToi: `${RUN}-loRT` };
  for (const [id, by] of [[lo.A, uid], [lo.B, khacId], [lo.rongKhac, khacId], [lo.rongToi, uid]] as const) await loMoi(id, by);
  await loCoPhanHoi(lo.A, mA, "a");
  await loCoPhanHoi(lo.B, mB, "b");
  tag = Number((await one(sql`INSERT INTO training_batch_tags (name, color) VALUES (${RUN + "-tag"}, '#3b82f6') RETURNING id`)).id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${factories[0]})`);
  c = (await import("./trainingBatchCommentsRouter")).trainingBatchCommentsRouter.createCaller({ user: { id: u.id, role: "supervisor", name: u.name, openId: u.name, twoFactorEnabled: true } } as never);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM training_batch_tag_assignments WHERE "batchId" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM training_batch_comments WHERE "batchId" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM training_batch_tags WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_feedback WHERE "trainingBatchId" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_suggestions WHERE suggestion LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_training_batches WHERE "batchId" LIKE ${like}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("trainingBatchComments", () => {
  it("bình luận / gán nhãn / gỡ nhãn lô có phản hồi của máy B hoặc lô rỗng của người khác ⇒ NOT_FOUND, không ghi; lô A và lô rỗng của chính mình ⇒ được", async () => {
    const l = [
      await maLoi(() => c.addComment({ batchId: lo.B, content: "hack" })),
      await maLoi(() => c.addComment({ batchId: lo.rongKhac, content: "hack" })),
      await maLoi(() => c.assignTag({ batchId: lo.B, tagId: tag })),
      await maLoi(() => c.removeTag({ batchId: lo.B, tagId: tag })),
    ];
    expect(l).toEqual([NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM training_batch_comments WHERE "batchId" IN (${lo.B}, ${lo.rongKhac})`)).toBe(0);
    expect(await so(sql`SELECT count(*)::int AS n FROM training_batch_tag_assignments WHERE "batchId" = ${lo.B}`)).toBe(0);
    expect(await maLoi(() => c.addComment({ batchId: lo.A, content: "ok" }))).toBeNull();
    expect(await maLoi(() => c.addComment({ batchId: lo.rongToi, content: "ok" }))).toBeNull();
    expect(await maLoi(() => c.assignTag({ batchId: lo.A, tagId: tag }))).toBeNull();
    expect(await maLoi(() => c.removeTag({ batchId: lo.A, tagId: tag }))).toBeNull();
  });
  it("sửa / xoá nhãn dùng chung bởi người hẹp ⇒ NOT_FOUND, nhãn còn nguyên", async () => {
    const l = [await maLoi(() => c.updateTag({ tagId: tag, name: `${RUN}-doi` })), await maLoi(() => c.deleteTag({ tagId: tag }))];
    expect(l).toEqual([NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM training_batch_tags WHERE id = ${tag} AND name = ${RUN + "-tag"}`)).toBe(1);
  });
});
