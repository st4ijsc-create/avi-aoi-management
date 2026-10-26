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

  it("★ KHÔNG ĐỔI: gán lại đúng (vai, phạm vi, chế độ, đích, dự phòng) ⇒ { khongDoi: true, daThay: 0 } — KHÔNG retire, KHÔNG chèn hàng giống hệt (id giữ nguyên, vẫn đúng 1 hàng sống)", async () => {
    const db = (await getDb())!;
    const sinh = () => db.select().from(aiModelBindings).where(and(eq(aiModelBindings.scopeId, SCOPE), eq(aiModelBindings.mode, "active"), isNull(aiModelBindings.retiredAt)));
    const truoc = await sinh();
    expect(truoc).toHaveLength(1);
    const dem = async () => (await db.select().from(aiModelBindings).where(and(eq(aiModelBindings.scopeId, SCOPE), eq(aiModelBindings.mode, "active")))).length; // KỂ CẢ hàng đã retire
    const tongTruoc = await dem();
    const lai = await datGanModel(db, yc({ envKey: "GGUF_CODE_MODEL" }), null);
    expect(lai).toEqual({ id: truoc[0].id, daThay: 0, khongDoi: true });
    expect((await sinh()).map((g) => g.id)).toEqual([truoc[0].id]);
    expect(await dem()).toBe(tongTruoc); // không chèn thêm hàng (kể cả hàng sẽ bị retire ngay)
  });

  it("★ ĐỔI thật vẫn thay: đổi đích / thêm dự phòng / đổi THỨ TỰ dự phòng ⇒ retire hàng cũ + hàng mới (khongDoi vắng); gán lại đúng dự phòng ⇒ khongDoi; chế độ khác không bị ảnh hưởng", async () => {
    const db = (await getDb())!;
    const dem = async () => (await db.select().from(aiModelBindings).where(and(eq(aiModelBindings.scopeId, SCOPE), isNull(aiModelBindings.retiredAt)))).length;
    const a = await datGanModel(db, yc({ envKey: "GGUF_CODE_MODEL", fallback: [`${TT}-pa`] }), null);
    expect(a.khongDoi).toBeUndefined();
    expect(a.daThay).toBe(1);
    const b = await datGanModel(db, yc({ envKey: "GGUF_CODE_MODEL", fallback: [`${TT}-pa`] }), null);
    expect(b).toEqual({ id: a.id, daThay: 0, khongDoi: true });
    const c = await datGanModel(db, yc({ envKey: "GGUF_CODE_MODEL", fallback: [`${TT}-pa`, `${TT}-pb`] }), null);
    expect(c.khongDoi).toBeUndefined();
    expect(c.daThay).toBe(1);
    const d = await datGanModel(db, yc({ envKey: "GGUF_CODE_MODEL", fallback: [`${TT}-pb`, `${TT}-pa`] }), null); // đổi THỨ TỰ
    expect(d.khongDoi).toBeUndefined();
    expect(d.daThay).toBe(1);
    const e = await datGanModel(db, yc({ profileId: `${TT}-pb`, fallback: [`${TT}-pb`, `${TT}-pa`] }), null); // đổi ĐÍCH (env → hồ sơ)
    expect(e.khongDoi).toBeUndefined();
    expect(e.daThay).toBe(1);
    const truoc = await dem();
    await datGanModel(db, yc({ profileId: `${TT}-pb`, fallback: [`${TT}-pb`, `${TT}-pa`] }), null);
    expect(await dem()).toBe(truoc); // gán trùng không đổi số hàng sống
    // chế độ khác: gán 'thu' trùng hàng thu có sẵn ⇒ khongDoi; không đụng hàng active
    const thu = await datGanModel(db, yc({ profileId: `${TT}-pa`, mode: "thu" }), null);
    expect(thu.khongDoi).toBe(true);
  });

  it("cổng vẫn chạy TRƯỚC khi coi là trùng: gán lại một đích bị cổng chặn vẫn bị từ chối (không 'khongDoi' trá hình)", async () => {
    const db = (await getDb())!;
    expect(await maLoi(datGanModel(db, yc({ profileId: `${TT}-pa`, mode: "active" }), null))).toBe("GIAY_PHEP_CHUA_RO");
  });
});
