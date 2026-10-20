import { afterAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiModelArtifacts } from "../../../../drizzle/schema";
import { dongBoKhoModel, suyRaArtifact } from "./dongBoKhoModel";

describe("suyRaArtifact (thuần)", () => {
  it("MoE Qwen3.6", () => {
    expect(suyRaArtifact("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf")).toEqual({
      id: "qwen3.6-35b-a3b-ud-q4-k-xl", family: "qwen3.6", quant: "UD-Q4_K_XL", loai: "sinh-chu", paramsTotalB: 35, paramsActiveB: 3,
    });
  });
  it("embedding / mmproj / reranker / fim", () => {
    expect(suyRaArtifact("Qwen3-Embedding-0.6B-f16.gguf")).toMatchObject({ loai: "nhung", paramsTotalB: 0.6, quant: "F16" });
    expect(suyRaArtifact("Qwen3-VL-8B-mmproj-F16.gguf")).toMatchObject({ loai: "chieu-thi-giac", paramsTotalB: 8 });
    expect(suyRaArtifact("bge-reranker-v2-m3-Q8_0.gguf")).toMatchObject({ loai: "xep-hang", quant: "Q8_0" });
    expect(suyRaArtifact("qwen2.5-coder-1.5b-q8_0.gguf")).toMatchObject({ family: "qwen2.5-coder", paramsTotalB: 1.5, quant: "Q8_0" });
  });
  it("id an toàn, ≤ 96 ký tự", () => {
    const s = suyRaArtifact(`${"x".repeat(200)} ../ạ.gguf`);
    expect(s.id).toMatch(/^[a-z0-9.-]+$/);
    expect(s.id.length).toBeLessThanOrEqual(96);
  });
});

describe("dongBoKhoModel (DB _test)", () => {
  const TT = "t7kho";
  afterAll(async () => {
    const db = await getDb();
    if (db) await db.delete(aiModelArtifacts).where(like(aiModelArtifacts.filePath, `${TT}%`));
  });
  const tep = (ten: string) => ({ ten, kichThuoc: 1048576 * 3, loai: "sinh-chu" as const, lyDoKhongHoTro: null });

  it("thêm, đánh dấu mất, xuất hiện lại; danh sách rỗng KHÔNG đánh dấu mất", async () => {
    const db = (await getDb())!;
    const k1 = await dongBoKhoModel({ thuMuc: "X", db, liet: () => [tep(`${TT}-A-7B-Q4_K_M.gguf`), tep(`${TT}-B-1B-Q8_0.gguf`)] });
    expect(k1.them + k1.capNhat).toBe(2);
    const k2 = await dongBoKhoModel({ thuMuc: "X", db, liet: () => [tep(`${TT}-A-7B-Q4_K_M.gguf`)] });
    expect(k2.capNhat).toBe(1);
    const rows = await db.select().from(aiModelArtifacts).where(like(aiModelArtifacts.filePath, `${TT}%`));
    const st = Object.fromEntries(rows.map((r) => [r.filePath, r.status]));
    expect(st).toEqual({ [`${TT}-A-7B-Q4_K_M.gguf`]: "available", [`${TT}-B-1B-Q8_0.gguf`]: "missing" });
    expect(rows.find((r) => r.filePath.startsWith(`${TT}-A`))?.vramWeightsMb).toBe(3);

    expect(await dongBoKhoModel({ thuMuc: "X", db, liet: () => [] })).toEqual({ them: 0, capNhat: 0, mat: 0 });
    await dongBoKhoModel({ thuMuc: "X", db, liet: () => [tep(`${TT}-A-7B-Q4_K_M.gguf`), tep(`${TT}-B-1B-Q8_0.gguf`)] });
    const sau = await db.select().from(aiModelArtifacts).where(like(aiModelArtifacts.filePath, `${TT}%`));
    expect(sau.every((r) => r.status === "available")).toBe(true);
  });

  it("thư mục không tồn tại ⇒ không làm gì", async () => {
    expect(await dongBoKhoModel({ thuMuc: "Z:/khong/co/thu/muc" })).toEqual({ them: 0, capNhat: 0, mat: 0 });
  });
});
