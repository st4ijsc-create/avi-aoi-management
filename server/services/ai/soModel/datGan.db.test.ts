import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiModelArtifacts, aiModelBindings, aiModelEvalRuns, aiServingProfiles } from "../../../../drizzle/schema";
import { datGanModel, LoiDatGan, type YeuCauDatGan } from "./datGan";

const TT = "t7gan";
const SCOPE = `${TT}-du-an`;
const yc = (o: Partial<YeuCauDatGan>): YeuCauDatGan => ({
  roleId: "code.plc", scopeKind: "project", scopeId: SCOPE, profileId: null, envKey: null, fallback: [], mode: "active", ...o,
});

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiDatGan ? e.ma : String(e);
  }
}

describe("datGanModel (DB _test, Đợt 7.0)", () => {
  beforeAll(async () => {
    const db = (await getDb())!;
    // Dọn dữ liệu SÓT của lượt trước bị ngắt (afterAll không chạy) — xem afterAll bên dưới (cùng danh sách xoá)
    await db.delete(aiModelBindings).where(eq(aiModelBindings.scopeId, SCOPE));
    await db.delete(aiModelEvalRuns).where(like(aiModelEvalRuns.profileId, `${TT}%`));
    await db.delete(aiServingProfiles).where(like(aiServingProfiles.id, `${TT}%`));
    await db.delete(aiModelArtifacts).where(like(aiModelArtifacts.id, `${TT}%`));
    await db.insert(aiModelArtifacts).values([
      { id: `${TT}-a`, filePath: `${TT}-a.gguf`, family: "probe" },
      { id: `${TT}-b`, filePath: `${TT}-b.gguf`, family: "probe", license: "apache-2.0" },
    ]);
    await db.insert(aiServingProfiles).values([
      { id: `${TT}-pa`, artifactId: `${TT}-a`, slotClass: "nho", ctx: 4096 },
      { id: `${TT}-pb`, artifactId: `${TT}-b`, slotClass: "nho", ctx: 4096 },
    ]);
  });
  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(aiModelBindings).where(eq(aiModelBindings.scopeId, SCOPE));
    await db.delete(aiModelEvalRuns).where(like(aiModelEvalRuns.profileId, `${TT}%`));
    await db.delete(aiServingProfiles).where(like(aiServingProfiles.id, `${TT}%`));
    await db.delete(aiModelArtifacts).where(like(aiModelArtifacts.id, `${TT}%`));
  });

  it("cổng: đích sai / vai trò lạ / profile lạ / giấy phép chưa rõ / chưa đo", async () => {
    const db = (await getDb())!;
    expect(await maLoi(datGanModel(db, yc({}), null))).toBe("DICH_SAI");
    expect(await maLoi(datGanModel(db, yc({ envKey: "GGUF_X" as never }), null))).toBe("DICH_SAI");
    expect(await maLoi(datGanModel(db, yc({ roleId: "khong.co", envKey: "GGUF_CODE_MODEL" }), null))).toBe("VAI_TRO_KHONG_CO");
    expect(await maLoi(datGanModel(db, yc({ profileId: `${TT}-zz`, mode: "thu" }), null))).toBe("PROFILE_KHONG_CO");
    expect(await maLoi(datGanModel(db, yc({ profileId: `${TT}-pa` }), null))).toBe("GIAY_PHEP_CHUA_RO");
    expect(await maLoi(datGanModel(db, yc({ profileId: `${TT}-pb` }), null))).toBe("CHUA_CO_DO");
  });

  it("thu được không cần đo; active sau khi có lượt đo; gán lại retire hàng cũ", async () => {
    const db = (await getDb())!;
    expect(await maLoi(datGanModel(db, yc({ profileId: `${TT}-pa`, mode: "thu" }), null))).toBeNull();
    await db.insert(aiModelEvalRuns).values({ profileId: `${TT}-pb`, suite: "plc-st-v1", nTasks: 30, nPass: 20, nRuns: 3 });
    const k1 = await datGanModel(db, yc({ profileId: `${TT}-pb` }), null);
    expect(k1.daThay).toBe(0);
    const k2 = await datGanModel(db, yc({ envKey: "GGUF_CODE_MODEL" }), null);
    expect(k2.daThay).toBe(1);
    const conHieuLuc = await db
      .select()
      .from(aiModelBindings)
      .where(and(eq(aiModelBindings.scopeId, SCOPE), isNull(aiModelBindings.retiredAt)));
    expect(conHieuLuc.map((g) => `${g.mode}:${g.profileId ?? g.envKey}`).sort()).toEqual(["active:GGUF_CODE_MODEL", `thu:${TT}-pa`]);
  });
});
