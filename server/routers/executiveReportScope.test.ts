/**
 * doc 69 T9 (security fast-follow, mirrors Wave-0 T3) — factory scope + per-user rate
 * limit on `server/routers/executiveReportRouter.ts` (`list`/`latest`/`schedulerStatus`).
 *
 * Before this task, `list`/`latest` were `protectedProcedure` calling
 * `getExecutiveSummaries({period, limit})` with NO factoryCode at all — the service reads
 * every persisted `ai_insights` row tagged `source='exec_report'` system-wide, so ANY
 * authenticated user (including a factory-scoped one) could read every factory's
 * executive/management data. Proven below: a factory-scoped caller's request is now
 * narrowed to their OWN factory (asserted on the mock call), and an ambiguous/ out-of-
 * scope caller never reaches the service at all — mirroring exactly how
 * `server/routers/aiAnalyticsScope.test.ts` proves the sibling T3 fix.
 *
 * Mocks only `accessControl.getUserAssignmentCodes` (the factory-assignment lookup
 * `enforceAnalyticsFactoryScope` resolves through) and the
 * `services/aiExecutiveReport` functions the router calls directly (kept pure/
 * user-unaware, scope is enforced only at the router boundary — same separation of
 * concerns T3 established). The per-user rate limiter runs for REAL (genuine in-process
 * fixed-window state), not a stub.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock the ESTABLISHED factory-assignment lookup (accessControl.ts) ─────────────
const mockGetUserAssignmentCodes = vi.fn();
vi.mock("../_core/accessControl", () => ({
  getUserAssignmentCodes: (...a: unknown[]) => mockGetUserAssignmentCodes(...a),
}));

// ─── Mock the service this router calls directly ───────────────────────────────────
const getExecutiveSummaries = vi.fn();
const runExecutiveReportNow = vi.fn();
vi.mock("../services/aiExecutiveReport", () => ({
  getExecutiveSummaries: (...a: unknown[]) => getExecutiveSummaries(...a),
  runExecutiveReportNow: (...a: unknown[]) => runExecutiveReportNow(...a),
}));

const getExecutiveReportSchedulerStatus = vi.fn(() => ({
  enabled: false,
  timezone: "Asia/Ho_Chi_Minh",
  periods: ["day"],
  crons: {},
  running: false,
}));
vi.mock("../services/reportScheduler", () => ({
  getExecutiveReportSchedulerStatus: (...a: unknown[]) => getExecutiveReportSchedulerStatus(...a),
}));

// ─── Mock the DB used ONLY by `firstFactoryCodeInScope`'s corporate→factories fallback
// (server/_core/aiAnalyticsScope.ts) — every other scope path (admin, single-factory,
// multi-factory-with-direct-assignments) never touches the DB at all (mirrors the same
// mock pattern as server/routers/aiAnalyticsScope.test.ts). ────────────────────────────
const mockGetDb = vi.fn();
vi.mock("../db/connection", () => ({
  getDb: (...a: unknown[]) => mockGetDb(...a),
}));

/** Fluent drizzle-query-builder stub for `select(...).from(...).where(...).orderBy(...).limit(n)`. */
function dbFactoryRowsStub(rows: Array<{ code: string }>) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = () => builder as unknown as ReturnType<typeof dbFactoryRowsStub>;
  builder.select = vi.fn(self);
  builder.from = vi.fn(self);
  builder.where = vi.fn(self);
  builder.orderBy = vi.fn(self);
  builder.limit = vi.fn(async (n: number) => rows.slice(0, n));
  return builder;
}

const importRouter = async () => (await import("./executiveReportRouter")).executiveReportRouter;
const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;

function mockScope(opts: { isAdmin?: boolean; factoryCodes?: string[]; corporateCodes?: string[] }) {
  mockGetUserAssignmentCodes.mockResolvedValue({
    isAdmin: !!opts.isAdmin,
    factoryCodes: opts.factoryCodes ?? [],
    corporateCodes: opts.corporateCodes ?? [],
  });
}

function makeRow(id: number, factoryCode: string | null) {
  return {
    id,
    period: "day",
    factoryCode,
    title: `Report ${id}`,
    severity: "info",
    createdAt: new Date("2026-07-25T00:00:00.000Z"),
    summary: { headline: `h${id}`, kpis: { factoryCode: factoryCode ?? undefined } } as never,
  };
}

beforeEach(() => {
  mockGetUserAssignmentCodes.mockReset();
  getExecutiveSummaries.mockReset();
  runExecutiveReportNow.mockReset();
  getExecutiveReportSchedulerStatus.mockClear();
  mockGetDb.mockReset();
  delete process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN;
});

afterEach(() => {
  delete process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN;
});

describe("executiveReportRouter.list — factory scope (doc 69 T9)", () => {
  it("(a) factory-scoped user gets only their own factory's rows — service called with their factoryCode", async () => {
    mockScope({ factoryCodes: ["F01"] });
    getExecutiveSummaries.mockResolvedValue([makeRow(1, "F01")]);
    const caller = (await importRouter()).createCaller(ctxFor(101, "operator"));

    const result = await caller.list({ limit: 10 });

    expect(result).toEqual([makeRow(1, "F01")]);
    expect(getExecutiveSummaries).toHaveBeenCalledOnce();
    expect(getExecutiveSummaries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, factoryCode: "F01" }),
    );
  });

  it("(b) REVIEW FIX (Important): a factory-scoped user with MULTIPLE assigned factories no longer gets FORBIDDEN on mount — defaults to their FIRST in-scope factory, deterministically (sorted, not insertion-order)", async () => {
    // Before the review fix this call threw FORBIDDEN, hard-erroring ManagementInsight.tsx
    // /controlTower/panels.tsx/ExecutiveMobile.tsx on mount for every multi-factory
    // manager. factoryCodes given OUT OF ORDER on purpose ("F02" before "F01") to prove
    // the pick is alphabetically sorted, not whatever order the assignment rows came back
    // in — genuinely deterministic across calls/caches.
    mockScope({ factoryCodes: ["F02", "F01"] });
    getExecutiveSummaries.mockResolvedValue([makeRow(1, "F01")]);
    const caller = (await importRouter()).createCaller(ctxFor(102, "supervisor"));

    const result = await caller.list({ limit: 10 });

    expect(result).toEqual([makeRow(1, "F01")]);
    // THE LEAK STAYS CLOSED: the service is called with exactly ONE of the caller's own
    // factories (never `undefined` = every factory, never "F02" picked arbitrarily).
    expect(getExecutiveSummaries).toHaveBeenCalledOnce();
    expect(getExecutiveSummaries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, factoryCode: "F01" }),
    );
  });

  it("REVIEW FIX: multi-factory user can still explicitly pick ANY of their OWN factories via the new optional factoryCode input — not just the default", async () => {
    mockScope({ factoryCodes: ["F01", "F02"] });
    getExecutiveSummaries.mockResolvedValue([makeRow(2, "F02")]);
    const caller = (await importRouter()).createCaller(ctxFor(109, "supervisor"));

    const result = await caller.list({ limit: 10, factoryCode: "F02" });

    expect(result).toEqual([makeRow(2, "F02")]);
    expect(getExecutiveSummaries).toHaveBeenCalledWith(expect.objectContaining({ factoryCode: "F02" }));
  });

  it("REVIEW FIX: explicit factoryCode OUTSIDE the caller's scope is still FORBIDDEN — the leak stays closed even with the new optional input", async () => {
    mockScope({ factoryCodes: ["F01", "F02"] });
    const caller = (await importRouter()).createCaller(ctxFor(110, "supervisor"));

    await expect(caller.list({ limit: 10, factoryCode: "F99" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getExecutiveSummaries).not.toHaveBeenCalled();
  });

  it("REVIEW FIX: a single-factory manager's explicit factoryCode for their OWN factory works", async () => {
    mockScope({ factoryCodes: ["F01"] });
    getExecutiveSummaries.mockResolvedValue([makeRow(3, "F01")]);
    const caller = (await importRouter()).createCaller(ctxFor(111, "operator"));

    await caller.list({ limit: 10, factoryCode: "F01" });
    expect(getExecutiveSummaries).toHaveBeenCalledWith(expect.objectContaining({ factoryCode: "F01" }));
  });

  it("REVIEW FIX: a single-factory manager's explicit factoryCode for a DIFFERENT factory is FORBIDDEN — proves the single-factory silent-narrow path was NOT weakened", async () => {
    mockScope({ factoryCodes: ["F01"] });
    const caller = (await importRouter()).createCaller(ctxFor(112, "operator"));

    await expect(caller.list({ limit: 10, factoryCode: "F02" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getExecutiveSummaries).not.toHaveBeenCalled();
  });

  it("scoped user with ZERO assigned factories (and no corporate) is rejected, service never called", async () => {
    mockScope({});
    const caller = (await importRouter()).createCaller(ctxFor(103, "viewer"));

    await expect(caller.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getExecutiveSummaries).not.toHaveBeenCalled();
  });

  it("(c) a global/admin role is unrestricted — factoryCode undefined, sees every row", async () => {
    mockScope({ isAdmin: true });
    getExecutiveSummaries.mockResolvedValue([makeRow(1, "F01"), makeRow(2, null)]);
    const caller = (await importRouter()).createCaller(ctxFor(104, "admin"));

    const result = await caller.list({ limit: 10 });

    expect(result).toHaveLength(2);
    expect(getExecutiveSummaries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, factoryCode: undefined }),
    );
  });

  it("REVIEW FIX (Important): a corporate-only user (no direct factory assignment) no longer gets FORBIDDEN on mount — defaults to the first factory owned by their corporate (real DB lookup)", async () => {
    mockScope({ factoryCodes: [], corporateCodes: ["C1"] });
    mockGetDb.mockResolvedValue(dbFactoryRowsStub([{ code: "F05" }]));
    getExecutiveSummaries.mockResolvedValue([makeRow(5, "F05")]);
    const caller = (await importRouter()).createCaller(ctxFor(105, "supervisor"));

    const result = await caller.list({ limit: 10 });

    expect(result).toEqual([makeRow(5, "F05")]);
    expect(getExecutiveSummaries).toHaveBeenCalledWith(expect.objectContaining({ factoryCode: "F05" }));
  });

  it("a corporate-only user whose corporate currently owns ZERO factories is still FORBIDDEN — nothing resolvable, fail CLOSED (never falls back to the unscoped/global view)", async () => {
    mockScope({ factoryCodes: [], corporateCodes: ["C9"] });
    mockGetDb.mockResolvedValue(dbFactoryRowsStub([]));
    const caller = (await importRouter()).createCaller(ctxFor(106, "supervisor"));

    await expect(caller.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getExecutiveSummaries).not.toHaveBeenCalled();
  });

  it("unauthenticated caller is rejected with UNAUTHORIZED", async () => {
    const caller = (await importRouter()).createCaller({ user: null } as never);
    await expect(caller.list({ limit: 10 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getExecutiveSummaries).not.toHaveBeenCalled();
  });
});

describe("executiveReportRouter.latest — factory scope + on-demand scoped generation (doc 69 T9)", () => {
  it("(a) factory-scoped user with an existing persisted row for their factory gets it back, no regeneration", async () => {
    mockScope({ factoryCodes: ["F01"] });
    getExecutiveSummaries.mockResolvedValue([makeRow(9, "F01")]);
    const caller = (await importRouter()).createCaller(ctxFor(201, "operator"));

    const result = await caller.latest(undefined);

    expect(result).toEqual(makeRow(9, "F01"));
    expect(getExecutiveSummaries).toHaveBeenCalledOnce();
    expect(getExecutiveSummaries).toHaveBeenCalledWith(expect.objectContaining({ factoryCode: "F01" }));
    expect(runExecutiveReportNow).not.toHaveBeenCalled();
  });

  it("scoped user with NOTHING persisted yet for their factory triggers a cheap, safe on-demand generation (skipLlm + notify:false) and returns the newly-tagged row", async () => {
    mockScope({ factoryCodes: ["F02"] });
    // First call (before generating): nothing yet. Second call (after generating): the
    // freshly-persisted, factory-tagged row.
    getExecutiveSummaries.mockResolvedValueOnce([]).mockResolvedValueOnce([makeRow(10, "F02")]);
    runExecutiveReportNow.mockResolvedValue({ summary: { headline: "h" } as never, insightId: 10 });
    const caller = (await importRouter()).createCaller(ctxFor(202, "operator"));

    const result = await caller.latest({ period: "day" });

    expect(result).toEqual(makeRow(10, "F02"));
    expect(runExecutiveReportNow).toHaveBeenCalledOnce();
    expect(runExecutiveReportNow).toHaveBeenCalledWith(
      "day",
      undefined,
      "F02",
      expect.objectContaining({ notify: false, skipLlm: true }),
    );
    expect(getExecutiveSummaries).toHaveBeenCalledTimes(2);
  });

  it("global/admin with nothing persisted gets null — unchanged legacy behavior, no on-demand generation for admin", async () => {
    mockScope({ isAdmin: true });
    getExecutiveSummaries.mockResolvedValue([]);
    const caller = (await importRouter()).createCaller(ctxFor(203, "admin"));

    const result = await caller.latest(undefined);

    expect(result).toBeNull();
    expect(runExecutiveReportNow).not.toHaveBeenCalled();
  });

  it("REVIEW FIX (Important): a factory-scoped user with MULTIPLE assigned factories no longer gets FORBIDDEN on mount — `latest` (called with NO input by ManagementInsight.tsx/controlTower/panels.tsx/ExecutiveMobile.tsx) defaults to their FIRST in-scope factory instead of hard-erroring", async () => {
    mockScope({ factoryCodes: ["F02", "F01"] }); // out-of-order — proves the pick is sorted
    getExecutiveSummaries.mockResolvedValue([makeRow(11, "F01")]);
    const caller = (await importRouter()).createCaller(ctxFor(204, "supervisor"));

    const result = await caller.latest(undefined);

    expect(result).toEqual(makeRow(11, "F01"));
    // THE LEAK STAYS CLOSED: called with exactly ONE of the caller's own factories, never
    // the system-wide aggregate (factoryCode: undefined) and no on-demand generation
    // needed since a row already exists for the defaulted factory.
    expect(getExecutiveSummaries).toHaveBeenCalledWith(expect.objectContaining({ factoryCode: "F01" }));
    expect(runExecutiveReportNow).not.toHaveBeenCalled();
  });

  it("REVIEW FIX: explicit factoryCode input to `latest` is validated the same way as `list` — in-scope works, out-of-scope FORBIDDEN", async () => {
    mockScope({ factoryCodes: ["F01", "F02"] });
    getExecutiveSummaries.mockResolvedValue([makeRow(12, "F02")]);
    const okCaller = (await importRouter()).createCaller(ctxFor(212, "supervisor"));
    const result = await okCaller.latest({ factoryCode: "F02" });
    expect(result).toEqual(makeRow(12, "F02"));
    expect(getExecutiveSummaries).toHaveBeenCalledWith(expect.objectContaining({ factoryCode: "F02" }));

    const forbidCaller = (await importRouter()).createCaller(ctxFor(213, "supervisor"));
    await expect(forbidCaller.latest({ factoryCode: "F99" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("(d) exceeding the per-user rate limit returns TOO_MANY_REQUESTS", async () => {
    mockScope({ factoryCodes: ["F01"] });
    getExecutiveSummaries.mockResolvedValue([makeRow(1, "F01")]);
    process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN = "2";
    const caller = (await importRouter()).createCaller(ctxFor(205, "operator"));

    await caller.latest(undefined); // 1/2
    await caller.latest(undefined); // 2/2
    await expect(caller.latest(undefined)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("rate limit is per-user — a DIFFERENT user is unaffected by another user's exhausted budget", async () => {
    mockScope({ factoryCodes: ["F01"] });
    getExecutiveSummaries.mockResolvedValue([makeRow(1, "F01")]);
    process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN = "1";
    const router = await importRouter();
    const callerA = router.createCaller(ctxFor(206, "operator"));
    const callerB = router.createCaller(ctxFor(207, "operator"));

    await callerA.latest(undefined); // exhausts A's budget
    await expect(callerA.latest(undefined)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(callerB.latest(undefined)).resolves.toBeDefined(); // B still has budget
  });
});

describe("executiveReportRouter.schedulerStatus — no business data, still gated (doc 69 T9)", () => {
  it("returns status for an authenticated (any role) caller", async () => {
    mockScope({ factoryCodes: ["F01"] });
    const caller = (await importRouter()).createCaller(ctxFor(301, "operator"));

    const result = await caller.schedulerStatus();
    expect(result).toMatchObject({ enabled: false });
    expect(getExecutiveReportSchedulerStatus).toHaveBeenCalledOnce();
  });

  it("unauthenticated caller is rejected with UNAUTHORIZED", async () => {
    const caller = (await importRouter()).createCaller({ user: null } as never);
    await expect(caller.schedulerStatus()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("per-user rate limit also applies here", async () => {
    mockScope({ factoryCodes: ["F01"] });
    process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN = "1";
    const caller = (await importRouter()).createCaller(ctxFor(302, "operator"));

    await caller.schedulerStatus();
    await expect(caller.schedulerStatus()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

// Note: `generateNow` (admin-only mutation) is intentionally UNTOUCHED by this task
// (still `adminProcedure`, no factoryCode, generates the global report exactly as
// before) — not re-tested here to avoid coupling this suite to adminProcedure's own
// unrelated 2FA/audit middleware chain, which this task does not modify.
