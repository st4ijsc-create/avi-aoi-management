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

  it("(b) THE LEAK, closed: a factory-scoped user with MULTIPLE assigned factories is rejected instead of getting an unscoped (all-factory) read — before this task there was no ownership check at all and this call would have returned every factory's data", async () => {
    mockScope({ factoryCodes: ["F01", "F02"] });
    const caller = (await importRouter()).createCaller(ctxFor(102, "supervisor"));

    await expect(caller.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
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

  it("a corporate-only user (no direct factory assignment) is ambiguous → FORBIDDEN, never guessed", async () => {
    mockScope({ factoryCodes: [], corporateCodes: ["C1"] });
    const caller = (await importRouter()).createCaller(ctxFor(105, "supervisor"));

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

  it("THE LEAK, closed: a factory-scoped user with MULTIPLE assigned factories is rejected — before this task `latest` had no ownership check and would have returned the system-wide aggregate to any authenticated user", async () => {
    mockScope({ factoryCodes: ["F01", "F02"] });
    const caller = (await importRouter()).createCaller(ctxFor(204, "supervisor"));

    await expect(caller.latest(undefined)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getExecutiveSummaries).not.toHaveBeenCalled();
    expect(runExecutiveReportNow).not.toHaveBeenCalled();
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
