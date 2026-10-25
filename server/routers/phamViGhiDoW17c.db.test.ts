/**
 * ★★★ Lô W17c — CÁC THỦ TỤC AI "TÍNH TOÁN THUẦN" nhận KHOÁ ẢNH do client gửi (kiểm định phamViGhi 2026-10-25).
 * Miễn trừ ghi "tính toán thuần trên ảnh người dùng đưa vào, không đọc dữ liệu nhà máy" SAI với các thủ tục nhận `imageKey`: server đọc tệp theo khoá rồi trả MÔ TẢ của model / vector gần nhất
 * ⇒ người nhà máy A đọc được nội dung ảnh nhà máy B bằng khoá. Nay khoá phải thuộc phạm vi người gọi (khoaAnhChoPhep / anhTrongPhamVi): ngoài phạm vi, khoá lạ, "..", không tra ngược được
 * ≡ ảnh không tồn tại (NOT_FOUND "Image not found") TRƯỚC khi đọc tệp hay gọi model; tìm ảnh tương tự chỉ trả ảnh của máy trong phạm vi (machineIds).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw25${process.pid}${Date.now().toString(36)}`;
const GOC = fs.mkdtempSync(path.join(os.tmpdir(), "w17c-"));
process.env.LOCAL_STORAGE_DIR = GOC;

const lanGoi: Array<{ machineIds: number[] | null | undefined }> = [];
vi.mock("../services/aiImageEmbedding", async (orig) => ({
  ...((await orig()) as object),
  searchByImage: vi.fn(async (_m: unknown, _b: unknown, _l: unknown, f?: { machineIds?: number[] | null }) => {
    lanGoi.push({ machineIds: f?.machineIds });
    return { results: [], embedding: { vector: [], dim: 0 }, searchMode: "text", embeddingSource: "text" };
  }),
}));
vi.mock("../services/aiVisionLanguage", async (orig) => ({
  ...((await orig()) as object),
  describeDefect: vi.fn(async () => ({ description: "mock", defects: [] })),
  compareImages: vi.fn(async () => ({ summary: "mock" })),
  generateQAReport: vi.fn(async () => ({ summary: "mock" })),
}));

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
let ctxA: never;
let ctxAdm: never;
let mA = 0;
let mB = 0;
const keyA = `${RUN}/a.png`;
const keyB = `${RUN}/b.png`;
const codes: string[] = [];

async function maLoi(chay: () => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return { code: String((e as { code?: string }).code ?? "LOI_LA"), message: (e as Error).message };
  }
}
const khongThayAnh = (r: { code: string; message: string } | null) => r !== null && r.code === "NOT_FOUND" && r.message === "Image not found";

async function seed(ten: string): Promise<number> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code}, 'AOI', true) RETURNING id`);
  codes.push(code);
  return Number(m.id);
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const u = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw25", ts: RUN, ten: "PW25 ua" });
  const adm = await taoNguoiDungTest("uadm", "admin", { tienTo: "pw25", ts: RUN, ten: "PW25 adm" });
  mA = await seed("a");
  mB = await seed("b");
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${codes[0]})`);
  ctxA = { user: { id: u.id, role: "supervisor", name: u.name, openId: u.name, twoFactorEnabled: true } } as never;
  ctxAdm = { user: { id: adm.id, role: "admin", name: adm.name, openId: adm.name, twoFactorEnabled: true } } as never;
  fs.mkdirSync(path.join(GOC, RUN), { recursive: true });
  fs.writeFileSync(path.join(GOC, keyA), "A");
  fs.writeFileSync(path.join(GOC, keyB), "B");
  for (const [k, m] of [[keyA, mA], [keyB, mB]] as const) {
    await dung(sql`INSERT INTO ai_image_embeddings ("imageUrl", embedding, "embeddingDim", "modelCode", "machineId") VALUES (${k}, '[0]', 1, 'm', ${m})`);
  }
}, 120_000);

afterAll(async () => {
  if (db) {
    await dung(sql`DELETE FROM ai_image_embeddings WHERE "imageUrl" LIKE ${RUN + "%"}`).catch(() => undefined);
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`).catch(() => undefined);
    for (const code of codes) {
      await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
      await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
      await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
      await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
    }
    await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  }
  fs.rmSync(GOC, { recursive: true, force: true });
});

describe("khoaAnhChoPhep", () => {
  it("ảnh của máy trong phạm vi ⇒ trả khoá chuẩn hoá; ảnh máy B / khoá lạ / '..' / không tra ngược được ⇒ NOT_FOUND; admin ⇒ mọi khoá hợp lệ", async () => {
    const { khoaAnhChoPhep } = await import("./_aiPhamVi");
    expect(await khoaAnhChoPhep(ctxA, keyA)).toBe(keyA);
    expect(await khoaAnhChoPhep(ctxA, `uploads/${keyA}`)).toBe(keyA); // dạng có tiền tố uploads/
    for (const k of [keyB, `${RUN}/khong-co.png`, "../etc/passwd", `${RUN}/../${RUN}/b.png`, "", 5]) {
      expect(khongThayAnh(await maLoi(() => khoaAnhChoPhep(ctxA, k))), String(k)).toBe(true);
    }
    expect(await khoaAnhChoPhep(ctxAdm, keyB)).toBe(keyB);
  });
});

describe("thủ tục AI nhận khoá ảnh — khoá ảnh nhà máy B bị từ chối TRƯỚC khi đọc tệp / gọi model", () => {
  it("aiVisionLanguage: describeDefect · compareImages (một trong hai khoá) · generateReport (một ảnh trong lô)", async () => {
    const { aiVisionLanguageRouter } = await import("./aiVisionLanguageRouter");
    const { describeDefect, compareImages, generateQAReport } = await import("../services/aiVisionLanguage");
    const c = aiVisionLanguageRouter.createCaller(ctxA);
    expect(khongThayAnh(await maLoi(() => c.describeDefect({ imageKey: keyB })))).toBe(true);
    expect(khongThayAnh(await maLoi(() => c.compareImages({ imageKeyA: keyA, imageKeyB: keyB })))).toBe(true);
    expect(khongThayAnh(await maLoi(() => c.generateReport({ images: [{ imageKey: keyA }, { imageKey: keyB }] })))).toBe(true);
    expect(vi.mocked(describeDefect)).not.toHaveBeenCalled();
    expect(vi.mocked(compareImages)).not.toHaveBeenCalled();
    expect(vi.mocked(generateQAReport)).not.toHaveBeenCalled();
    // đối chứng: ảnh trong phạm vi ⇒ qua cổng, model được gọi
    expect(await maLoi(() => c.describeDefect({ imageKey: keyA }))).toBeNull();
    expect(vi.mocked(describeDefect)).toHaveBeenCalledTimes(1);
  });
  it("aiAnalysisHub: imageDefectDescription · similarDefectSearch · quickQualityCheck; tìm ảnh tương tự chỉ trên máy trong phạm vi (machineIds)", async () => {
    const { aiAnalysisHubRouter } = await import("./aiAnalysisHubRouter");
    const { searchByImage } = await import("../services/aiImageEmbedding");
    const c = aiAnalysisHubRouter.createCaller(ctxA);
    lanGoi.length = 0;
    expect(khongThayAnh(await maLoi(() => c.imageDefectDescription({ imageKey: keyB })))).toBe(true);
    expect(khongThayAnh(await maLoi(() => c.similarDefectSearch({ imageKey: keyB })))).toBe(true);
    expect(khongThayAnh(await maLoi(() => c.quickQualityCheck({ imageKey: keyB })))).toBe(true);
    expect(vi.mocked(searchByImage)).not.toHaveBeenCalled();
    expect(await maLoi(() => c.similarDefectSearch({ imageKey: keyA }))).toBeNull();
    expect(await maLoi(() => c.quickQualityCheck({ imageKey: keyA }))).toBeNull();
    expect(lanGoi.length).toBe(2);
    for (const l of lanGoi) {
      expect(l.machineIds).toContain(mA);
      expect(l.machineIds).not.toContain(mB);
    }
    // toàn quyền: không lọc máy
    lanGoi.length = 0;
    expect(await maLoi(() => aiAnalysisHubRouter.createCaller(ctxAdm).similarDefectSearch({ imageKey: keyB }))).toBeNull();
    expect(lanGoi[0].machineIds ?? null).toBeNull();
  });
  it("aiImageSearch.searchByUpload theo khoá ảnh: ảnh nhà máy B ⇒ NOT_FOUND và KHÔNG tìm vector; ảnh trong phạm vi ⇒ tìm trên máy trong phạm vi", async () => {
    const { aiImageSearchRouter } = await import("./aiImageSearchRouter");
    const { searchByImage } = await import("../services/aiImageEmbedding");
    const c = aiImageSearchRouter.createCaller(ctxA);
    vi.mocked(searchByImage).mockClear();
    lanGoi.length = 0;
    expect(khongThayAnh(await maLoi(() => c.searchByUpload({ imageKey: keyB, limit: 5 })))).toBe(true);
    expect(vi.mocked(searchByImage)).not.toHaveBeenCalled();
    expect(await maLoi(() => c.searchByUpload({ imageKey: keyA, limit: 5 }))).toBeNull();
    expect(lanGoi[0].machineIds).toContain(mA);
    expect(lanGoi[0].machineIds).not.toContain(mB);
  });
});
