import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiModelArtifacts, aiServingProfiles } from "../../../../drizzle/schema";
import { luuHoSo, LoiSuaSoModel, suaArtifact, type YeuCauLuuHoSo } from "./suaSoModel";

const TT = "t74sua";

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiSuaSoModel ? e.ma : String(e);
  }
}

const hs = (o: Partial<YeuCauLuuHoSo>): YeuCauLuuHoSo => ({
  id: `${TT}-p@8k`, artifactId: `${TT}-chu`, slotClass: "nang", ctx: 8192, thinking: "auto", enabled: true, ...o,
});

describe("suaSoModel (DB _test, Đợt 7.4)", () => {
  beforeAll(async () => {
    const db = (await getDb())!;
    await db.insert(aiModelArtifacts).values([
      { id: `${TT}-chu`, filePath: `${TT}-chu.gguf`, family: "probe" },
      { id: `${TT}-nhung`, filePath: `${TT}-nhung.gguf`, family: "probe", loai: "nhung" },
      { id: `${TT}-mat`, filePath: `${TT}-mat.gguf`, family: "probe", status: "missing" },
    ]);
  });
  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(aiServingProfiles).where(like(aiServingProfiles.id, `${TT}%`));
    await db.delete(aiModelArtifacts).where(like(aiModelArtifacts.id, `${TT}%`));
  });

  it("suaArtifact: khai giấy phép + cách ly rồi bỏ cách ly; trạng thái khác được giữ", async () => {
    const db = (await getDb())!;
    expect(await suaArtifact(db, { id: `${TT}-chu`, license: "apache-2.0" })).toEqual({ id: `${TT}-chu`, license: "apache-2.0", status: "available" });
    expect((await suaArtifact(db, { id: `${TT}-chu`, status: "quarantined" })).status).toBe("quarantined");
    const r = await suaArtifact(db, { id: `${TT}-chu`, status: "available" });
    expect(r).toEqual({ id: `${TT}-chu`, license: "apache-2.0", status: "available" });
  });

  it("suaArtifact: từ chối — không có / rỗng / hình dạng sai / đặt tay `missing` / artifact đang mất", async () => {
    const db = (await getDb())!;
    expect(await maLoi(suaArtifact(db, { id: `${TT}-zz`, license: "mit" }))).toBe("ARTIFACT_KHONG_CO");
    expect(await maLoi(suaArtifact(db, { id: `${TT}-chu` }))).toBe("DAU_VAO_SAI");
    expect(await maLoi(suaArtifact(db, { id: `${TT}-chu`, license: "Apache 2.0" }))).toBe("DAU_VAO_SAI");
    expect(await maLoi(suaArtifact(db, { id: `${TT}-chu`, status: "missing" as never }))).toBe("DAU_VAO_SAI");
    expect(await maLoi(suaArtifact(db, { id: `${TT}-mat`, status: "available" }))).toBe("ARTIFACT_MAT");
    // Artifact đang mất vẫn khai giấy phép được (giấy phép không phụ thuộc tệp có trên đĩa).
    expect((await suaArtifact(db, { id: `${TT}-mat`, license: "mit" })).status).toBe("missing");
  });

  it("luuHoSo: tạo mới rồi sửa (upsert) — serverArgs/sampling giữ `{}`", async () => {
    const db = (await getDb())!;
    expect(await luuHoSo(db, hs({}))).toEqual({ id: `${TT}-p@8k`, taoMoi: true });
    expect(await luuHoSo(db, hs({ ctx: 65536, thinking: "off", enabled: false, slotClass: "nho" }))).toEqual({ id: `${TT}-p@8k`, taoMoi: false });
    const [p] = await db.select().from(aiServingProfiles).where(eq(aiServingProfiles.id, `${TT}-p@8k`));
    expect(p).toMatchObject({ artifactId: `${TT}-chu`, slotClass: "nho", ctx: 65536, thinking: "off", enabled: false, serverArgs: {}, sampling: {} });
  });

  it("luuHoSo: từ chối — artifact không có / không sinh chữ / id sai / ctx ngoài khoảng", async () => {
    const db = (await getDb())!;
    expect(await maLoi(luuHoSo(db, hs({ id: `${TT}-q1`, artifactId: `${TT}-zz` })))).toBe("ARTIFACT_KHONG_CO");
    expect(await maLoi(luuHoSo(db, hs({ id: `${TT}-q2`, artifactId: `${TT}-nhung` })))).toBe("LOAI_KHONG_PHUC_VU");
    expect(await maLoi(luuHoSo(db, hs({ id: `${TT}-Q3` })))).toBe("DAU_VAO_SAI");
    expect(await maLoi(luuHoSo(db, hs({ id: `${TT}-q4`, ctx: 256 })))).toBe("DAU_VAO_SAI");
    expect(await maLoi(luuHoSo(db, hs({ id: `${TT}-q5`, ctx: 300_000 })))).toBe("DAU_VAO_SAI");
    const sot = await db.select({ id: aiServingProfiles.id }).from(aiServingProfiles).where(like(aiServingProfiles.id, `${TT}-q%`));
    expect(sot).toEqual([]);
  });
});
