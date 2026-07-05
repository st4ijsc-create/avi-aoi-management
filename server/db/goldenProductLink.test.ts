/**
 * Doc 31 PM5 / OP7 (WB-3) — golden ↔ product link queries.
 *
 * Covers listGoldenReferencesForProduct (FK path + legacy productCode fallback +
 * exclusion of other products) and listReleaseGoldenRefs (active+approved-only
 * provenance slice). Uses the shared in-memory FakeDb; drizzle eq/and/or/isNull/
 * desc are mocked to JS predicate builders (same technique as
 * thresholdGovernanceService.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, type Row } from "../routers/__otFakeDb";
import { goldenSampleReferences } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: makeEq,
    and: makeAnd,
    desc: makeDesc,
    or: (...conds: Array<(r: Row) => boolean>) => (r: Row) => conds.some((c) => c(r)),
    isNull: (col: { name: string }) => (r: Row) => r[col.name] == null,
  };
});
vi.mock("./connection", () => ({ getDb: vi.fn(async () => fake) }));

import { listGoldenReferencesForProduct, listReleaseGoldenRefs } from "./goldenSample";

const now = Date.now();
function seed() {
  fake.seed(goldenSampleReferences, [
    // A — linked by FK to product 100
    { id: 1, productModelId: 100, productCode: "PRD-100", roiKey: "MP1", version: 3, active: true, status: "approved", updatedAt: now + 5 },
    // B — legacy (no FK) but productCode matches product 100's code → fallback match
    { id: 2, productModelId: null, productCode: "PRD-100", roiKey: "MP2", version: 1, active: true, status: "approved", updatedAt: now + 4 },
    // C — draft on product 100 (FK) — matched by list, excluded by release refs
    { id: 3, productModelId: 100, productCode: "PRD-100", roiKey: "MP3", version: 2, active: false, status: "draft", updatedAt: now + 3 },
    // D — superseded approved (active=false) — matched by list, excluded by release refs (active only)
    { id: 4, productModelId: 100, productCode: "PRD-100", roiKey: "MP1", version: 1, active: false, status: "approved", updatedAt: now + 2 },
    // E — legacy row with a DIFFERENT code → must NOT match product 100
    { id: 5, productModelId: null, productCode: "OTHER", roiKey: "X", version: 1, active: true, status: "approved", updatedAt: now + 1 },
    // F — FK to a DIFFERENT product → must NOT match product 100
    { id: 6, productModelId: 200, productCode: "PRD-200", roiKey: "Y", version: 1, active: true, status: "approved", updatedAt: now },
  ]);
}

beforeEach(() => {
  fake.store.clear();
  seed();
});

describe("listGoldenReferencesForProduct — FK + legacy fallback", () => {
  it("matches BOTH the FK-linked rows and legacy rows whose productCode matches", async () => {
    const rows = await listGoldenReferencesForProduct({ productModelId: 100, productCode: "PRD-100" });
    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4]); // A,B,C,D — NOT E (other code) or F (other product)
  });

  it("excludes a legacy row whose code matches a DIFFERENT product", async () => {
    const rows = await listGoldenReferencesForProduct({ productModelId: 100, productCode: "PRD-100" });
    expect(rows.some((r) => r.id === 5)).toBe(false);
  });

  it("without productCode, matches ONLY the FK-linked rows (no legacy fallback)", async () => {
    const rows = await listGoldenReferencesForProduct({ productModelId: 100 });
    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 3, 4]); // FK rows only (no B)
  });

  it("activeOnly + status filters compose with the link condition", async () => {
    const rows = await listGoldenReferencesForProduct({
      productModelId: 100, productCode: "PRD-100", activeOnly: true, status: "approved",
    });
    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2]); // active+approved only
  });
});

describe("listReleaseGoldenRefs — active + approved provenance only", () => {
  it("returns only active approved goldens (drafts + superseded excluded), slimmed", async () => {
    const refs = await listReleaseGoldenRefs({ productModelId: 100, productCode: "PRD-100" });
    expect(refs.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2]);
    // Provenance shape: id + version + key fields, no image payload.
    expect(refs[0]).toMatchObject({ id: expect.any(Number), version: expect.any(Number), roiKey: expect.any(String), status: "approved" });
    expect(refs[0]).not.toHaveProperty("grayBase64");
  });

  it("returns [] for a product with no goldens", async () => {
    const refs = await listReleaseGoldenRefs({ productModelId: 999, productCode: "PRD-999" });
    expect(refs).toEqual([]);
  });
});
