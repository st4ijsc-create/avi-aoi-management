/**
 * CỔNG CSDL THẬT — lô L5b (rà bảo mật tRPC, 2026-10-25): ĐỌC của aiImageSearch.findSimilar · clusterDefects · stats theo PHẠM VI người dùng (dùng lại `VectorSearchFilters.machineIds` của W12a).
 *
 * Lỗ: người nhà máy A tìm ảnh tương tự từ một embedding bất kỳ (kể cả của nhà máy B), gom cụm lỗi và đếm embedding của MỌI nhà máy.
 * Luật: chỉ ảnh của máy trong phạm vi (ảnh không gắn máy bị loại với người hẹp); embedding nguồn ngoài phạm vi ≡ không tồn tại (cùng NOT_FOUND); phạm vi rỗng ⇒ rỗng; admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";
import { storeEmbedding, DEFAULT_EMBEDDING_DIM } from "../services/aiImageEmbedding";

const RUN = `l5b${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
interface NhaMay { mid: number; code: string; emb: number; emb2: number }
let A!: NhaMay;
let B!: NhaMay;
let embMoCoi = 0;
const factories: string[] = [];
type U = { id: number; role: string; name: string };
let ua!: U;
let uadm!: U;
let utrang!: U;
const vec = () => Array.from({ length: DEFAULT_EMBEDDING_DIM }, (_, i) => (i % 7) / 7 + 0.01);
let router: typeof import("./aiImageSearchRouter").aiImageSearchRouter;
const goi = (u: U) => router.createCaller({ user: { ...u, twoFactorEnabled: true } } as never);
const sx = (a: number[]) => [...a].sort((p, q) => p - q);

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  factories.push(code);
  const mk = (k: string) => storeEmbedding({ imageUrl: `${code}${k}.jpg`, embedding: vec(), dim: DEFAULT_EMBEDDING_DIM, modelCode: RUN, label: RUN, machineId: Number(m.id) });
  return { mid: Number(m.id), code, emb: await mk(""), emb2: await mk("-2") };
}
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const x = e as { code?: string };
    const meta = readAppErrorMeta(e);
    return `${x.code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  router = (await import("./aiImageSearchRouter")).aiImageSearchRouter;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  embMoCoi = await storeEmbedding({ imageUrl: `${RUN}-mo-coi.jpg`, embedding: vec(), dim: DEFAULT_EMBEDDING_DIM, modelCode: RUN, label: RUN });
  const u = await taoNguoiDungTest("ua", "engineer", { tienTo: "l5b", ts: RUN, ten: "L5b ua" });
  ua = { id: u.id, role: "engineer", name: u.name };
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  const ad = await taoNguoiDungTest("uadm", "admin", { tienTo: "l5b", ts: RUN, ten: "L5b adm" });
  uadm = { id: ad.id, role: "admin", name: ad.name };
  const tr = await taoNguoiDungTest("utrang", "engineer", { tienTo: "l5b", ts: RUN, ten: "L5b trang" });
  utrang = { id: tr.id, role: "engineer", name: tr.name };
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

async function qChu(q: string): Promise<void> {
  const { default: postgres } = await import("postgres");
  const u = new URL(process.env.DATABASE_URL!);
  if (!/_test$/.test(u.pathname.replace(/^\//, ""))) throw new Error("từ chối: không phải CSDL _test");
  u.username = "aoi";
  u.password = "aoi";
  const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try { await chu.unsafe(q); } finally { await chu.end({ timeout: 5 }); }
}
const ids = (r: { id: number }[]) => sx(r.map((x) => x.id));

describe("★★★ aiImageSearch.findSimilar — chỉ ảnh của máy trong phạm vi", () => {
  it("từ embedding của A: A chỉ thấy ảnh máy A khác (không B, không ảnh mồ côi); admin thấy cả ba bên", async () => {
    const r = await goi(ua).findSimilar({ embeddingId: A.emb, limit: 50, label: RUN });
    expect(ids(r)).toEqual([A.emb2]);
    const adm = await goi(uadm).findSimilar({ embeddingId: A.emb, limit: 50, label: RUN });
    expect(ids(adm)).toEqual(sx([A.emb2, B.emb, B.emb2, embMoCoi]));
  });
  it("khai machineId của B ⇒ rỗng; người không gán nhà máy nào ⇒ NOT_FOUND giống embedding không tồn tại", async () => {
    expect(ids(await goi(ua).findSimilar({ embeddingId: A.emb, limit: 50, label: RUN, machineId: B.mid }))).toEqual([]);
    expect(await loi(() => goi(utrang).findSimilar({ embeddingId: A.emb, limit: 50, label: RUN }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:imageEmbedding");
  });
  it("embedding NGUỒN thuộc B hoặc không gắn máy ⇒ NOT_FOUND y hệt embedding không có thật (không dùng ảnh nhà máy khác làm mồi)", async () => {
    const khongCo = await loi(() => goi(ua).findSimilar({ embeddingId: 2147483000, limit: 10 }));
    expect(khongCo).toBe("NOT_FOUND:ENTITY_NOT_FOUND:imageEmbedding");
    expect(await loi(() => goi(ua).findSimilar({ embeddingId: B.emb, limit: 10, label: RUN }))).toBe(khongCo);
    expect(await loi(() => goi(ua).findSimilar({ embeddingId: embMoCoi, limit: 10, label: RUN }))).toBe(khongCo);
    expect(await loi(() => goi(uadm).findSimilar({ embeddingId: B.emb, limit: 10, label: RUN }))).toBeNull();
  });
});

describe("★★★ aiImageSearch.clusterDefects — chỉ gom ảnh của máy trong phạm vi", () => {
  it("A: mọi cụm chỉ chứa ảnh A; admin gom cả ba bên; không gán nhà máy ⇒ không cụm", async () => {
    const tat = (cl: { members: { id: number }[] }[]) => sx(cl.flatMap((c) => c.members.map((m) => m.id)));
    expect(tat(await goi(ua).clusterDefects({ label: RUN, minSimilarity: 0.5, limit: 1000 }))).toEqual(sx([A.emb, A.emb2]));
    expect(tat(await goi(uadm).clusterDefects({ label: RUN, minSimilarity: 0.5, limit: 1000 }))).toEqual(sx([A.emb, A.emb2, B.emb, B.emb2, embMoCoi]));
    expect(await goi(utrang).clusterDefects({ label: RUN, minSimilarity: 0.5, limit: 1000 })).toEqual([]);
    expect(await goi(ua).clusterDefects({ label: RUN, machineId: B.mid, minSimilarity: 0.5, limit: 1000 })).toEqual([]);
  });
});

describe("★★★ aiImageSearch.stats — chỉ đếm ảnh của máy trong phạm vi", () => {
  it("đếm theo máy: A thấy 2 của A, 0 của B; admin thấy 2 của B; không gán nhà máy ⇒ 0", async () => {
    expect((await goi(ua).stats({ machineId: A.mid })).totalEmbeddings).toBe(2);
    expect((await goi(ua).stats({ machineId: B.mid })).totalEmbeddings).toBe(0);
    expect((await goi(uadm).stats({ machineId: B.mid })).totalEmbeddings).toBe(2);
    expect((await goi(utrang).stats({ machineId: A.mid })).totalEmbeddings).toBe(0);
  });
  it("không khai máy: tổng của A KHÔNG gồm ảnh của B và ảnh mồ côi (admin lớn hơn ≥ 3: 2 của B + 1 mồ côi)", async () => {
    await qChu(`UPDATE ai_image_embeddings SET embedding_vec = embedding::vector WHERE label = '${RUN}'`).catch((e) => { throw new Error("không index được vector: " + e.message); });
    const a = await goi(ua).stats();
    const adm = await goi(uadm).stats();
    expect(adm.totalEmbeddings - a.totalEmbeddings).toBeGreaterThanOrEqual(3);
    expect((await goi(utrang).stats()).totalEmbeddings).toBe(0);
    // indexedCount (đếm vector đã index) cũng phải theo phạm vi
    if (adm.pgvectorAvailable) {
      expect(adm.indexedCount - a.indexedCount).toBeGreaterThanOrEqual(3);
      expect((await goi(utrang).stats()).indexedCount).toBe(0);
    }
  });
});
