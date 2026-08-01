/**
 * Doc 51 P2 fix — the __UNMAPPED__ sentinel product model must survive being
 * SOFT-DELETED. The old ensureUnmappedProductModelId did getByCode (filters
 * deletedAt) → miss → plain INSERT → product_models_code_unique violation, which
 * crashed EVERY submitInspection for an unresolved product. ensureSystemProductModel
 * resurrects the tombstoned row instead.
 *
 * Integration test (real cloned test DB; run under the owner role for cleanup).
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as db from "../db";
import { getDb } from "../db";
import { productModels } from "../../drizzle/schema";
import { UNMAPPED_PRODUCT_MODEL_CODE } from "./measurementPointResolver";

const SENTINEL = {
  code: UNMAPPED_PRODUCT_MODEL_CODE,
  name: "Unmapped (auto-provisioned) measurement points",
  description: "test",
} as const;

describe("Doc 51 P2 — __UNMAPPED__ sentinel resurrect-on-ensure", () => {
  it("resurrects a SOFT-DELETED sentinel instead of throwing unique violation", async () => {
    const d = await getDb();
    if (!d) throw new Error("no db");

    // Ensure the sentinel exists, then SOFT-DELETE it (reproduce the prod state).
    const firstId = await db.ensureSystemProductModel({ ...SENTINEL });
    await d
      .update(productModels)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(productModels.code, UNMAPPED_PRODUCT_MODEL_CODE));

    // A plain create would now throw product_models_code_unique. ensure must NOT.
    const resurrectedId = await db.ensureSystemProductModel({ ...SENTINEL });
    expect(resurrectedId).toBe(firstId); // same physical row

    const [row] = await d
      .select({ id: productModels.id, deletedAt: productModels.deletedAt, isActive: productModels.isActive })
      .from(productModels)
      .where(eq(productModels.code, UNMAPPED_PRODUCT_MODEL_CODE));
    expect(row.deletedAt).toBeNull(); // tombstone cleared
    expect(row.isActive).toBe(true);
  });

  it("is idempotent on an already-active sentinel (no throw, stable id)", async () => {
    const a = await db.ensureSystemProductModel({ ...SENTINEL });
    const b = await db.ensureSystemProductModel({ ...SENTINEL });
    expect(a).toBe(b);
  });
});
