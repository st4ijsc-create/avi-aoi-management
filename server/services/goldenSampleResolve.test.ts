/**
 * W5-B (doc 27 §5 gap F8) — golden-sample operator-flow surfacing tests.
 *
 * Covers the two READ-ONLY additions used by the goldenSample router:
 *   * resolveActiveReference — exact-key match with product-level fallback
 *     (real test DB, guarded skip like goldenSample.invariant.test.ts)
 *   * referenceThumbnailDataUrl — raw gray plane → browser-renderable PNG
 *     data URL (pure sharp round-trip, no DB requirement beyond the seed row)
 */
import { describe, it, expect, afterAll } from "vitest";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { setGoldenReference } from "../db/goldenSample";
import { resolveActiveReference, referenceThumbnailDataUrl } from "./goldenSampleService";

const PREFIX = `W5B-F8-${Date.now()}`;

function asRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

// 2×2 gray plane: distinct pixel values so the PNG round-trip is verifiable.
const GRAY_2X2 = Buffer.from([0, 85, 170, 255]);
const baseRow = { grayBase64: GRAY_2X2.toString("base64"), width: 2, height: 2 } as const;

// Top-level guard: DB reachable + golden table present (0158/0170/0182 era).
const db = await getDb();
let ready = false;
if (db) {
  try {
    const res = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'golden_sample_references'
    `);
    ready = asRows(res).length > 0;
  } catch {
    ready = false;
  }
}
if (!ready) {
  // eslint-disable-next-line no-console
  console.warn("[goldenSampleResolve.test] SKIP — test DB unreachable or golden_sample_references missing.");
}

describe.skipIf(!ready)("goldenSample surfacing — resolveActiveReference (real DB)", () => {
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM golden_sample_references WHERE "productCode" LIKE ${PREFIX + "%"}`);
  });

  it("exact ROI key wins; unknown ROI falls back to the product-level golden; nothing → null", async () => {
    const productCode = `${PREFIX}-P1`;
    const productLevel = await setGoldenReference({ ...baseRow, productCode });
    const roiLevel = await setGoldenReference({ ...baseRow, productCode, roiKey: "MP001" });

    // Exact (product + roi) → the ROI-scoped row.
    const exact = await resolveActiveReference({ productCode, roiKey: "MP001" });
    expect(exact?.matchedLevel).toBe("exact");
    expect(exact?.row.id).toBe(roiLevel.id);

    // Unknown ROI → product-level fallback, honestly labelled.
    const fallback = await resolveActiveReference({ productCode, roiKey: "MP999" });
    expect(fallback?.matchedLevel).toBe("product");
    expect(fallback?.row.id).toBe(productLevel.id);

    // Fallback disabled → null (no fabrication).
    const strict = await resolveActiveReference({ productCode, roiKey: "MP999" }, { fallbackToProductLevel: false });
    expect(strict).toBeNull();

    // Unknown product → null.
    const none = await resolveActiveReference({ productCode: `${PREFIX}-NONE` });
    expect(none).toBeNull();
  });

  it("only the ACTIVE version resolves (superseded goldens stay history)", async () => {
    const productCode = `${PREFIX}-P2`;
    await setGoldenReference({ ...baseRow, productCode });
    const v2 = await setGoldenReference({ ...baseRow, productCode });
    const resolved = await resolveActiveReference({ productCode });
    expect(resolved?.row.id).toBe(v2.id);
    expect(resolved?.row.version).toBe(2);
    expect(resolved?.row.active).toBe(true);
  });

  it("referenceThumbnailDataUrl: raw gray plane → PNG data URL that decodes back losslessly", async () => {
    const productCode = `${PREFIX}-P3`;
    const row = await setGoldenReference({ ...baseRow, productCode });

    const dataUrl = await referenceThumbnailDataUrl(row);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);

    // Decode the PNG back to a raw gray plane — dimensions AND pixels must survive.
    const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    const { data, info } = await sharp(png).grayscale().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(2);
    expect(info.height).toBe(2);
    expect(Buffer.from(data).equals(GRAY_2X2)).toBe(true);
  });
});
