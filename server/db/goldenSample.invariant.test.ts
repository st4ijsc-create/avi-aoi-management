/**
 * W3-C (doc 27 §2 M10) — golden one-active invariant, REAL-DB integration test.
 *
 * Runs against the isolated test DB (vitest.setup.ts forces DATABASE_URL to
 * <db>_test). Verifies the 0182 partial unique index
 * `uq_golden_ref_one_active` actually rejects a second active row per
 * (productCode, recipeCode, stationCode, roiKey) — NULLs folded via COALESCE —
 * and that setGoldenReference resolves races to EXACTLY ONE active row.
 *
 * Honest skip: when the test DB is unreachable or migration 0182 has not been
 * applied to it, the suite is skipped (not silently green).
 */
import { describe, it, expect, afterAll } from "vitest";
import { sql, and, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { setGoldenReference, getActiveGoldenReference } from "./goldenSample";
import { goldenSampleReferences } from "../../drizzle/schema";

const PREFIX = `W3C-M10-${Date.now()}`;
const baseRow = { grayBase64: "AA==", width: 1, height: 1 } as const;

function asRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

// Top-level guard (vitest supports top-level await): DB reachable + 0182 index present.
const db = await getDb();
let ready = false;
if (db) {
  try {
    const res = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'golden_sample_references' AND indexname = 'uq_golden_ref_one_active'
    `);
    ready = asRows(res).length > 0;
  } catch {
    ready = false;
  }
}
if (!ready) {
  // eslint-disable-next-line no-console
  console.warn("[goldenSample.invariant.test] SKIP — test DB unreachable or 0182 not applied (uq_golden_ref_one_active missing).");
}

async function countActive(productCode: string): Promise<number> {
  const rows = await db!
    .select({ id: goldenSampleReferences.id })
    .from(goldenSampleReferences)
    .where(and(eq(goldenSampleReferences.productCode, productCode), eq(goldenSampleReferences.active, true)));
  return rows.length;
}

describe.skipIf(!ready)("golden_sample_references — one-active invariant (0182, real DB)", () => {
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM golden_sample_references WHERE "productCode" LIKE ${PREFIX + "%"}`);
  });

  it("DB rejects a second ACTIVE row for the same key (23505 on the partial index)", async () => {
    const productCode = `${PREFIX}-direct`;
    await db!.insert(goldenSampleReferences).values({ ...baseRow, productCode, version: 1, active: true });
    let failed: unknown = null;
    try {
      await db!.insert(goldenSampleReferences).values({ ...baseRow, productCode, version: 2, active: true });
    } catch (err) {
      failed = err;
    }
    expect(failed).not.toBeNull();
    const chain: string[] = [];
    let e: any = failed;
    for (let i = 0; e && i < 5; i++) { chain.push(`${e.code ?? ""}:${e.message ?? ""}`); e = e.cause; }
    expect(chain.join(" | ")).toMatch(/23505|uq_golden_ref_one_active|duplicate key/i);
    // An INACTIVE second row for the same key is still allowed (history).
    await db!.insert(goldenSampleReferences).values({ ...baseRow, productCode, version: 2, active: false });
    expect(await countActive(productCode)).toBe(1);
  });

  it("setGoldenReference: two sequential conflicting writes → exactly one active, version bumped", async () => {
    const productCode = `${PREFIX}-seq`;
    await setGoldenReference({ ...baseRow, productCode });
    const second = await setGoldenReference({ ...baseRow, productCode });
    expect(second.version).toBe(2);
    expect(await countActive(productCode)).toBe(1);
    const active = await getActiveGoldenReference({ productCode });
    expect(active?.id).toBe(second.id);
  });

  it("setGoldenReference: CONCURRENT set-active race → exactly one active survives", async () => {
    const productCode = `${PREFIX}-race`;
    const results = await Promise.allSettled([
      setGoldenReference({ ...baseRow, productCode }),
      setGoldenReference({ ...baseRow, productCode }),
    ]);
    // The retry path (catch 23505 → transactional deactivate-then-activate)
    // should let BOTH calls succeed; the invariant is the hard requirement.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await countActive(productCode)).toBe(1);
  });
});
