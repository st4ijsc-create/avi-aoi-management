/**
 * Đợt 7.0 — nạp sổ model từ CSDL `_test` (mig 0400 phải đã áp: `node scripts/apply-migration-0400.mjs --test-only`).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiModelArtifacts, aiModelBindings, aiServingProfiles } from "../../../../drizzle/schema";
import { VAI_TRO_GOC } from "../../../../shared/aiRoles";
import { napAnhSoModel } from "./napSoModel";

const TIEN_TO = "t7nap";

describe("napAnhSoModel (DB, Đợt 7.0)", () => {
  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(aiModelBindings).where(eq(aiModelBindings.scopeId, `${TIEN_TO}-du-an`));
    await db.delete(aiServingProfiles).where(like(aiServingProfiles.id, `${TIEN_TO}%`));
    await db.delete(aiModelArtifacts).where(like(aiModelArtifacts.id, `${TIEN_TO}%`));
  });

  it("seed: 11 vai trò khớp VAI_TRO_GOC, mỗi vai trò 1 gán global active theo-env", async () => {
    const anh = await napAnhSoModel();
    expect(anh.taiLuc).toBeGreaterThan(0);
    for (const v of VAI_TRO_GOC) {
      expect(anh.vaiTro.get(v.id), v.id).toEqual({ envKey: v.envKey, taskKind: v.taskKind });
      const g = anh.gan.filter((x) => x.roleId === v.id && x.scopeKind === "global" && x.mode === "active");
      expect(g, v.id).toHaveLength(1);
      expect(g[0].envKey).toBe(v.envKey);
    }
  });

  it("gán đã retire không vào ảnh; profile nối artifact", async () => {
    const db = (await getDb())!;
    await db.insert(aiModelArtifacts).values({ id: `${TIEN_TO}-a`, filePath: `${TIEN_TO}-a.gguf`, family: "probe", status: "missing" });
    await db.insert(aiServingProfiles).values({ id: `${TIEN_TO}-p`, artifactId: `${TIEN_TO}-a`, slotClass: "nho", ctx: 4096 });
    await db.insert(aiModelBindings).values([
      { roleId: "code.plc", scopeKind: "project", scopeId: `${TIEN_TO}-du-an`, profileId: `${TIEN_TO}-p`, mode: "active", retiredAt: new Date() },
      { roleId: "code.plc", scopeKind: "project", scopeId: `${TIEN_TO}-du-an`, profileId: `${TIEN_TO}-p`, mode: "thu" },
    ]);
    const anh = await napAnhSoModel(db);
    const g = anh.gan.filter((x) => x.scopeId === `${TIEN_TO}-du-an`);
    expect(g.map((x) => x.mode)).toEqual(["thu"]);
    expect(anh.profile.get(`${TIEN_TO}-p`)).toMatchObject({ artifactFile: `${TIEN_TO}-a.gguf`, artifactStatus: "missing", slotClass: "nho", license: "unknown" });
  });
});
