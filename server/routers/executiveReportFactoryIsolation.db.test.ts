/**
 * doc 69 T9 review fix (Minor) — INTEGRATION test proving the `ai_insights`
 * `contextJson->>'reportFactoryCode' = factoryCode` SQL filter (server/services/
 * aiExecutiveReport.ts `getExecutiveSummaries`) actually isolates rows at the DATABASE
 * level, against the real (isolated) test DB (vitest.setup.ts rewrites DATABASE_URL to
 * `<db>_test`).
 *
 * The router-boundary test (server/routers/executiveReportScope.test.ts) mocks
 * `getExecutiveSummaries` entirely — it proves the router CALLS the service with the
 * right `factoryCode`, but never exercises the actual SQL predicate. This file seeds
 * real rows for TWO distinct (uniquely-tagged) factories plus a global/null-factory row
 * in the SAME `ai_insights` table an admin's unscoped query also reads, then asserts a
 * factory-scoped caller's `list`/`latest` — going through the REAL router + REAL
 * `getExecutiveSummaries` (only `accessControl.getUserAssignmentCodes`, the
 * assignment-lookup layer, is mocked — a different concern, already covered elsewhere)
 * — returns ONLY their own factory's row, even though the sibling factory's row and the
 * global row are proven reachable (via a direct unscoped call) in the very same table.
 *
 * Also covers the review-fix (Important) finding-1 scenarios end-to-end against real
 * seeded data: a multi-factory-assigned caller with no `factoryCode` input defaults to
 * their FIRST in-scope factory (not FORBIDDEN) and gets back ONLY that factory's real
 * row; an explicit in-scope `factoryCode` works; an explicit out-of-scope `factoryCode`
 * is FORBIDDEN and never reaches the data (proven against a row that genuinely exists).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";

// ─── Mock ONLY the user→factory assignment lookup (a separate, already-unit-tested
// concern) — everything else (router, getExecutiveSummaries, the DB) is REAL. ─────────
const mockGetUserAssignmentCodes = vi.fn();
vi.mock("../_core/accessControl", () => ({
  getUserAssignmentCodes: (...a: unknown[]) => mockGetUserAssignmentCodes(...a),
}));

function mockScope(opts: { isAdmin?: boolean; factoryCodes?: string[] }) {
  mockGetUserAssignmentCodes.mockResolvedValue({
    isAdmin: !!opts.isAdmin,
    factoryCodes: opts.factoryCodes ?? [],
    corporateCodes: [],
  });
}

const DB_URL = process.env.DATABASE_URL;
const RUN = `t9iso_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
// "F01_..." sorts before "F02_..." lexically regardless of the RUN suffix (the tie-break
// digit comes first) — used to assert the deterministic "first in-scope factory" default.
const F01 = `F01_${RUN}`;
const F02 = `F02_${RUN}`;

const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;

let sql: ReturnType<typeof postgres>;
let idF01: number;
let idF02: number;
let idGlobal: number;

function contextJsonFor(factoryCode: string | null): Record<string, unknown> {
  return {
    period: "day",
    reportPeriod: "day",
    reportFactoryCode: factoryCode,
    headline: `T9-ISO row for ${factoryCode ?? "GLOBAL"}`,
    highlights: [],
    risks: [],
    recommendations: [],
    kpiTable: [],
    kpis: { factoryCode: factoryCode ?? undefined },
    generatedBy: "offline",
    generatedAt: new Date().toISOString(),
  };
}

describe.skipIf(!DB_URL)("executiveReportRouter — REAL row-level factory isolation (doc 69 T9 review fix, integration)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });

    // IMPORTANT: pass the plain JS object (no `JSON.stringify` + no `::jsonb` cast) — this
    // `postgres` client infers the target column's jsonb type from the INSERT's own
    // parameter description and serializes accordingly. Manually `JSON.stringify`-ing
    // first and casting `::jsonb` DOUBLE-encodes it (the driver serializes the
    // already-stringified text AGAIN into a jsonb *string scalar* containing escaped
    // JSON text, not a jsonb *object* — `->>'reportFactoryCode'` then reads back `null`
    // because there is no such key on a scalar). Verified against the real test DB while
    // authoring this file.
    const [rowF01] = await sql`
      INSERT INTO ai_insights (source, severity, title, body, "contextJson")
      VALUES ('exec_report', 'info', ${"T9-ISO " + F01}, 'seed', ${contextJsonFor(F01)})
      RETURNING id
    `;
    idF01 = rowF01.id;

    const [rowF02] = await sql`
      INSERT INTO ai_insights (source, severity, title, body, "contextJson")
      VALUES ('exec_report', 'info', ${"T9-ISO " + F02}, 'seed', ${contextJsonFor(F02)})
      RETURNING id
    `;
    idF02 = rowF02.id;

    const [rowGlobal] = await sql`
      INSERT INTO ai_insights (source, severity, title, body, "contextJson")
      VALUES ('exec_report', 'info', ${"T9-ISO GLOBAL " + RUN}, 'seed', ${contextJsonFor(null)})
      RETURNING id
    `;
    idGlobal = rowGlobal.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM ai_insights WHERE id IN ${sql([idF01, idF02, idGlobal])}`;
    await sql.end();
  });

  beforeEach(() => {
    mockGetUserAssignmentCodes.mockReset();
  });

  const importRouter = async () => (await import("./executiveReportRouter")).executiveReportRouter;

  it("sanity check: an unscoped read of the real table DOES reach all three seeded rows (proves the isolation below comes from the factoryCode filter, not from the data being unreachable)", async () => {
    const { getExecutiveSummaries } = await import("../services/aiExecutiveReport");
    const rows = await getExecutiveSummaries({ limit: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([idF01, idF02, idGlobal]));
  });

  it("a factory-scoped caller's `list` returns ONLY their own factory's real row — F02's and the global row (both genuinely present in the table) never come back", async () => {
    mockScope({ factoryCodes: [F01] });
    const caller = (await importRouter()).createCaller(ctxFor(900001, "operator"));

    const result = await caller.list({ limit: 100 });

    expect(result.map((r) => r.id)).toEqual([idF01]);
    expect(result.some((r) => r.id === idF02)).toBe(false);
    expect(result.some((r) => r.id === idGlobal)).toBe(false);
  });

  it("a DIFFERENT factory's scoped caller's `list` sees only THEIR row (F02) — proves this isn't just 'F01 happens to always win'", async () => {
    mockScope({ factoryCodes: [F02] });
    const caller = (await importRouter()).createCaller(ctxFor(900002, "operator"));

    const result = await caller.list({ limit: 100 });

    expect(result.map((r) => r.id)).toEqual([idF02]);
  });

  it("a factory-scoped caller's `latest` returns their own factory's row, not the sibling factory's or the global row", async () => {
    mockScope({ factoryCodes: [F01] });
    const caller = (await importRouter()).createCaller(ctxFor(900003, "operator"));

    const result = await caller.latest(undefined);

    expect(result?.id).toBe(idF01);
  });

  it("REVIEW FIX (finding 1, integration): a multi-factory-assigned caller with NO factoryCode input is NOT forbidden — defaults to their FIRST in-scope factory and gets back only that factory's real row", async () => {
    // Assigned to BOTH factories, given out of order — the router must default
    // deterministically to F01 (alphabetically first), never F02, never both/all.
    mockScope({ factoryCodes: [F02, F01] });
    const caller = (await importRouter()).createCaller(ctxFor(900004, "supervisor"));

    const result = await caller.list({ limit: 100 });

    expect(result.map((r) => r.id)).toEqual([idF01]);
  });

  it("REVIEW FIX (finding 1, integration): an explicit IN-scope factoryCode is honored against real data", async () => {
    mockScope({ factoryCodes: [F01, F02] });
    const caller = (await importRouter()).createCaller(ctxFor(900005, "supervisor"));

    const result = await caller.list({ limit: 100, factoryCode: F02 });

    expect(result.map((r) => r.id)).toEqual([idF02]);
  });

  it("REVIEW FIX (finding 1, integration): an explicit OUT-of-scope factoryCode is FORBIDDEN — F02's row genuinely exists but is never returned to an F01-only caller", async () => {
    mockScope({ factoryCodes: [F01] });
    const caller = (await importRouter()).createCaller(ctxFor(900006, "supervisor"));

    await expect(caller.list({ limit: 100, factoryCode: F02 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin (global) sees all three seeded rows through the real router — unrestricted, unchanged", async () => {
    mockScope({ isAdmin: true });
    const caller = (await importRouter()).createCaller(ctxFor(900007, "admin"));

    const result = await caller.list({ limit: 100 });
    const ids = result.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([idF01, idF02, idGlobal]));
  });
});
