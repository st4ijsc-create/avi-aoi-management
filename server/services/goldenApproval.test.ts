/**
 * W7-C (doc 27 §9 V11) — golden-sample approval workflow tests.
 *
 * DB integration against the isolated <db>_test (vitest.setup.ts / `npm run
 * test:db:setup`; migration 0189 applied by scripts/apply-migration-0189.mjs).
 * Soft-skips when the DB or the 0189 `status` column is missing.
 *
 * Covers:
 *  - capture (submitDraft) creates a DRAFT that is NEVER resolvable
 *  - SoD: the capturer cannot approve their own draft (GoldenSoDError)
 *  - approve by a DIFFERENT user → resolvable (capture→approve→resolve chain,
 *    incl. getReferenceGray decode)
 *  - approving a newer draft supersedes the previous active (one-active invariant)
 *  - grandfathering: the legacy direct-activate path (setGoldenReference) stays
 *    resolvable exactly like pre-0189 rows backfilled to 'approved'
 *  - reject: draft → retired, never activated
 *  - retire: approved → retired, removed from resolution
 *  - lifecycle guards: non-draft cannot be approved/rejected (GoldenStatusError)
 */
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  setGoldenReference,
  GoldenSoDError,
  GoldenStatusError,
} from "../db/goldenSample";
import {
  submitDraft,
  approveReference,
  rejectReference,
  retireReference,
  resolveActiveReference,
  getReferenceGray,
  setAlignBeforeDiff,
} from "./goldenSampleService";
import { goldenDiffForKey } from "./aiAdvancedVision";
import sharp from "sharp";

const PREFIX = `W7C-V11-${Date.now()}`;
const CAPTURER = 991_001;
const APPROVER = 991_002;

// 2×2 gray plane — enough to exercise storage/decode round-trips.
const GRAY_2X2 = Buffer.from([10, 90, 170, 250]);
const baseEncoded = { grayBase64: GRAY_2X2.toString("base64"), width: 2, height: 2, format: "gray-raw" as const };

function asRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

// Guard: DB reachable + golden table present + 0189 status column applied.
const db = await getDb();
let ready = false;
if (db) {
  try {
    const res = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'golden_sample_references' AND column_name = 'status'
    `);
    ready = asRows(res).length > 0;
  } catch {
    ready = false;
  }
}
if (!ready) {
  // eslint-disable-next-line no-console
  console.warn("[goldenApproval.test] SKIP — test DB unreachable or 0189 (status column) not applied.");
}

describe.skipIf(!ready)("golden approval workflow (V11, real DB)", () => {
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM golden_sample_references WHERE "productCode" LIKE ${PREFIX + "%"}`);
  });

  it("capture creates a DRAFT that is never resolvable", async () => {
    const productCode = `${PREFIX}-P1`;
    const draft = await submitDraft({ encoded: baseEncoded, productCode, createdBy: CAPTURER });
    expect(draft.status).toBe("draft");
    expect(draft.active).toBe(false);
    expect(draft.version).toBe(1);

    const resolved = await resolveActiveReference({ productCode });
    expect(resolved).toBeNull(); // drafts NEVER resolve
  });

  it("SoD: the capturer cannot approve their own draft", async () => {
    const productCode = `${PREFIX}-P2`;
    const draft = await submitDraft({ encoded: baseEncoded, productCode, createdBy: CAPTURER });
    await expect(approveReference({ id: draft.id, approvedBy: CAPTURER }))
      .rejects.toBeInstanceOf(GoldenSoDError);
    // Still a draft, still unresolvable.
    expect(await resolveActiveReference({ productCode })).toBeNull();
  });

  it("capture → approve (different user) → resolve chain, incl. gray decode", async () => {
    const productCode = `${PREFIX}-P3`;
    const draft = await submitDraft({ encoded: baseEncoded, productCode, createdBy: CAPTURER });
    const approved = await approveReference({ id: draft.id, approvedBy: APPROVER, note: "looks good" });
    expect(approved.status).toBe("approved");
    expect(approved.active).toBe(true);
    expect(approved.approvedBy).toBe(APPROVER);
    expect(approved.approvedAt).toBeInstanceOf(Date);
    expect(approved.approvalNote).toBe("looks good");

    const resolved = await resolveActiveReference({ productCode });
    expect(resolved?.row.id).toBe(draft.id);

    // Registration-pipeline consumer path: decodable gray plane.
    const gray = await getReferenceGray({ productCode });
    expect(gray?.gray.width).toBe(2);
    expect(gray?.gray.height).toBe(2);
    expect(Buffer.from(gray!.gray.data).equals(GRAY_2X2)).toBe(true);
  });

  it("approving a newer draft supersedes the previous active (one-active holds)", async () => {
    const productCode = `${PREFIX}-P4`;
    const v1 = await submitDraft({ encoded: baseEncoded, productCode, createdBy: CAPTURER });
    await approveReference({ id: v1.id, approvedBy: APPROVER });

    const v2 = await submitDraft({ encoded: baseEncoded, productCode, createdBy: CAPTURER });
    expect(v2.version).toBe(2);
    await approveReference({ id: v2.id, approvedBy: APPROVER });

    const resolved = await resolveActiveReference({ productCode });
    expect(resolved?.row.id).toBe(v2.id);

    // v1 is superseded: inactive but stays 'approved' history (not retired).
    const rows = asRows(await db!.execute(sql`
      SELECT id, active, status FROM golden_sample_references WHERE "productCode" = ${productCode} ORDER BY version
    `));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ active: false, status: "approved" });
    expect(rows[1]).toMatchObject({ active: true, status: "approved" });
  });

  it("grandfathering: legacy direct-activate rows resolve without an approval step", async () => {
    const productCode = `${PREFIX}-P5`;
    // setGoldenReference is the pre-0189 API — rows land status='approved'
    // exactly like the migration's backfill of pre-existing production rows.
    const legacy = await setGoldenReference({ ...baseEncoded, productCode });
    expect(legacy.status).toBe("approved");
    const resolved = await resolveActiveReference({ productCode });
    expect(resolved?.row.id).toBe(legacy.id);
  });

  it("reject: draft → retired, never activated; lifecycle guards hold", async () => {
    const productCode = `${PREFIX}-P6`;
    const draft = await submitDraft({ encoded: baseEncoded, productCode, createdBy: CAPTURER });
    const rejected = await rejectReference(draft.id, "blurry");
    expect(rejected.status).toBe("retired");
    expect(rejected.active).toBe(false);
    expect(await resolveActiveReference({ productCode })).toBeNull();

    // A retired row can be neither approved nor re-rejected.
    await expect(approveReference({ id: draft.id, approvedBy: APPROVER }))
      .rejects.toBeInstanceOf(GoldenStatusError);
    await expect(rejectReference(draft.id)).rejects.toBeInstanceOf(GoldenStatusError);
  });

  it("retire: approved golden leaves production resolution", async () => {
    const productCode = `${PREFIX}-P7`;
    const draft = await submitDraft({ encoded: baseEncoded, productCode, createdBy: CAPTURER });
    await approveReference({ id: draft.id, approvedBy: APPROVER });
    expect(await resolveActiveReference({ productCode })).not.toBeNull();

    const retired = await retireReference(draft.id, "product EOL");
    expect(retired.status).toBe("retired");
    expect(retired.active).toBe(false);
    expect(await resolveActiveReference({ productCode })).toBeNull();
  });

  it("alignBeforeDiff toggle persists (V7 per-golden flag, default true)", async () => {
    const productCode = `${PREFIX}-P8`;
    const draft = await submitDraft({ encoded: baseEncoded, productCode, createdBy: CAPTURER });
    expect(draft.alignBeforeDiff).toBe(true); // default ON
    const off = await setAlignBeforeDiff(draft.id, false);
    expect(off.alignBeforeDiff).toBe(false);
    const on = await setAlignBeforeDiff(draft.id, true);
    expect(on.alignBeforeDiff).toBe(true);
  });

  it("goldenDiffForKey runs the full stored-golden chain (resolve → normalize → align → diff)", async () => {
    const productCode = `${PREFIX}-P9`;

    // 128×128 textured golden (registration needs real gradients, not a 2×2 dot).
    const N = 128;
    const plane = Buffer.alloc(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        plane[y * N + x] = ((x >> 3) + (y >> 3)) % 2 ? 210 : 40; // 16-px checkerboard
      }
    }
    const draft = await submitDraft({
      encoded: { grayBase64: plane.toString("base64"), width: N, height: N, format: "gray-raw" },
      productCode,
      createdBy: CAPTURER,
    });

    // Draft → no diff possible (honest null).
    const candidatePng = await sharp(plane, { raw: { width: N, height: N, channels: 1 } }).png().toBuffer();
    expect(await goldenDiffForKey({ productCode }, candidatePng)).toBeNull();

    // Approved → the chain runs end-to-end against the stored gray plane.
    await approveReference({ id: draft.id, approvedBy: APPROVER });
    const r = await goldenDiffForKey({ productCode }, candidatePng);
    expect(r).not.toBeNull();
    expect(r!.golden.id).toBe(draft.id);
    expect(r!.golden.matchedLevel).toBe("exact");
    expect(r!.golden.alignBeforeDiff).toBe(true);
    expect(r!.normalized).toBe(true);          // V15 default ON
    expect(r!.alignment).not.toBeNull();        // V7 per-row flag ON → registration ran
    expect(r!.diffRatio).toBeLessThan(0.01);    // identical content → ~zero diff
    expect(r!.heatmapPng.length).toBeGreaterThan(0);
  });
});
