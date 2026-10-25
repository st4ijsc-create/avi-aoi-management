/**
 * ★★★ Lô W12 — phạm vi nhà máy của aiImageSearch.searchByVector / searchByUpload (kiểm định phamViGhi, 2026-10-25).
 * "Mutation đọc": trả ảnh (imageUrl, nhãn, máy) của các lần kiểm tra — trước đây từ MỌI nhà máy. Nay bộ lọc `machineIds` (phạm vi người gọi) đi xuống dịch vụ
 * ở cả ba tầng (HNSW · cast runtime · brute-force) và tầng metadata của searchByUpload: kỹ sư nhà máy A chỉ thấy ảnh của máy nhà máy A.
 * Ảnh không gắn máy bị loại với người bị thu hẹp phạm vi; toàn quyền (admin) thấy hết; người không gán nhà máy nào thấy rỗng.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { storeEmbedding, DEFAULT_EMBEDDING_DIM } from "../services/aiImageEmbedding";

const RUN = `pw14${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay {
  mid: number;
  code: string;
  emb: number;
}
let A!: NhaMay;
let B!: NhaMay;
let embMoCoi = 0;
const factories: string[] = [];
let ua!: { id: number; role: string; name: string };
const vec = () => Array.from({ length: DEFAULT_EMBEDDING_DIM }, (_, i) => (i % 7) / 7 + 0.01);
let router: typeof import("./aiImageSearchRouter").aiImageSearchRouter;
const goi = (u: { id: number; role: string; name: string }) => router.createCaller({ user: { ...u, twoFactorEnabled: true } } as never);

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  factories.push(code);
  const emb = await storeEmbedding({ imageUrl: `${code}.jpg`, embedding: vec(), dim: DEFAULT_EMBEDDING_DIM, modelCode: RUN, label: RUN, machineId: Number(m.id) });
  return { mid: Number(m.id), code, emb };
}
const tim = async (u: { id: number; role: string; name: string }) => {
  const r = await goi(u).searchByVector({ embedding: vec(), dim: DEFAULT_EMBEDDING_DIM, limit: 50, label: RUN });
  return r.results.map((x: { id: number }) => x.id).sort((p: number, q: number) => p - q);
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  router = (await import("./aiImageSearchRouter")).aiImageSearchRouter;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  embMoCoi = await storeEmbedding({ imageUrl: `${RUN}-mo-coi.jpg`, embedding: vec(), dim: DEFAULT_EMBEDDING_DIM, modelCode: RUN, label: RUN });
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "pw14", ts: RUN, ten: "PW14 ua" });
  ua = { id: u.id, role: "engineer", name: u.name };
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM ai_image_embeddings WHERE label = ${RUN}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("aiImageSearch.searchByVector — chỉ ảnh của máy trong phạm vi", () => {
  it("kỹ sư nhà máy A chỉ thấy ảnh máy A (không thấy máy B, không thấy ảnh không gắn máy)", async () => {
    expect(await tim(ua)).toEqual([A.emb]);
  });
  it("khai machineId của nhà máy B ⇒ rỗng (không rò, không lỗi khác)", async () => {
    const r = await goi(ua).searchByVector({ embedding: vec(), dim: DEFAULT_EMBEDDING_DIM, limit: 50, label: RUN, machineId: B.mid });
    expect(r.results).toEqual([]);
  });
  it("toàn quyền (admin) thấy cả ba; người không gán nhà máy nào thấy rỗng", async () => {
    const adm = await taoNguoiDungTest("uadm", "admin", { tienTo: "pw14", ts: RUN, ten: "PW14 adm" });
    expect(await tim({ id: adm.id, role: "admin", name: adm.name })).toEqual([A.emb, B.emb, embMoCoi].sort((p, q) => p - q));
    const trang = await taoNguoiDungTest("utrang", "engineer", { tienTo: "pw14", ts: RUN, ten: "PW14 trang" });
    expect(await tim({ id: trang.id, role: "engineer", name: trang.name })).toEqual([]);
  });
});
