/**
 * doc 69 Wave 0 / T3 — factory scope + per-user rate limit on the AI analytics/report
 * routers (server/routers/aiInspectionAnalyticsRouter.ts, server/routers/aiReportRouter.ts).
 *
 * Before this task neither router applied ANY ownership check against the calling
 * user: a factory-scoped user could pass `factoryCode`/`machineId` for a factory they
 * are not assigned to and the (user-unaware) analytics/report services would happily
 * return that factory's data — proven below by asserting the underlying service mock
 * is never even invoked once the router-level guard rejects the request (i.e. nothing
 * downstream would have cared). Only the GLOBAL (IP/session-keyed) `/api` rate limiter
 * guarded these expensive aggregation endpoints — no per-user throttle existed.
 *
 * Mocks only the two things these routers actually depend on for scope: the codebase's
 * EXISTING factory-assignment lookup (`accessControl.getUserAssignmentCodes` — the same
 * helper backing tenantScope/RLS and server/services/aiActionInbox.ts factoryScope) and
 * the DB join used to resolve a machineId's owning factory. The per-user rate limiter
 * (server/services/aiGateway.ts `checkNamedRateLimit`) is exercised for REAL (in-process
 * fixed-window map) — no mock — so test (d) proves actual throttling, not a stub.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// ─── Mock the ESTABLISHED factory-assignment lookup (accessControl.ts) ─────────────
const mockGetUserAssignmentCodes = vi.fn();
vi.mock("../_core/accessControl", () => ({
  getUserAssignmentCodes: (...a: unknown[]) => mockGetUserAssignmentCodes(...a),
}));

// ─── Mock the DB join used to resolve machineId → factory code (bonus machineId tests) ─
const mockGetDb = vi.fn();
vi.mock("../db/connection", () => ({
  getDb: (...a: unknown[]) => mockGetDb(...a),
}));

/** Fluent drizzle-query-builder stub: every step but the terminal `.limit()` returns itself. */
function dbRowsStub(rows: Array<Record<string, unknown>>) {
  const builder: Record<string, Mock> = {};
  const self = () => builder as unknown as ReturnType<typeof dbRowsStub>;
  builder.select = vi.fn(self);
  builder.from = vi.fn(self);
  builder.innerJoin = vi.fn(self);
  builder.where = vi.fn(self);
  builder.limit = vi.fn(async () => rows);
  return builder;
}

// ─── Mock the analytics/report SERVICES (kept pure/user-unaware — see brief) ───────
const getDefectTrend = vi.fn(async (params: unknown) => [{ params, date: "2026-07-01", total: 1, pass: 1, fail: 0, yieldRate: 100, defectRate: 0 }]);
const getDefectPareto = vi.fn(async (params: unknown) => [{ params, defectType: "x", count: 1, percentage: 100, cumulativePercentage: 100 }]);
const getMachinePerformance = vi.fn(async (params: unknown) => [{ params }]);
vi.mock("../services/aiInspectionAnalytics", () => ({
  getDefectTrend: (...a: unknown[]) => getDefectTrend(...a),
  getDefectPareto: (...a: unknown[]) => getDefectPareto(...a),
  getMachinePerformance: (...a: unknown[]) => getMachinePerformance(...a),
  forecastYield: vi.fn(async () => []),
  getCorrelationAnalysis: vi.fn(async () => []),
  assessRisks: vi.fn(async () => []),
  getControlChart: vi.fn(async () => ({})),
  getShiftAnalysis: vi.fn(async () => []),
  getDefectHeatmap: vi.fn(async () => []),
  generateComprehensiveReport: vi.fn(async () => ({})),
}));

const generateDailyQualitySummary = vi.fn(async (params: unknown) => ({ params, ok: true }));
vi.mock("../services/aiReportGenerator", () => ({
  generateDailyQualitySummary: (...a: unknown[]) => generateDailyQualitySummary(...a),
  generateRCAReport: vi.fn(async () => ({})),
  generateModelPerformanceReport: vi.fn(async () => ({})),
  generateExecutiveSummary: vi.fn(async () => ({})),
  generateReport: vi.fn(async () => ({})),
}));

import { cacheService } from "../services/cacheService";

const importAnalyticsRouter = async () => (await import("./aiInspectionAnalyticsRouter")).aiInspectionAnalyticsRouter;
const importReportRouter = async () => (await import("./aiReportRouter")).aiReportRouter;

const period = { startDate: "2026-07-01T00:00:00.000Z", endDate: "2026-07-02T00:00:00.000Z" };
const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;

function mockScope(opts: { isAdmin?: boolean; factoryCodes?: string[] }) {
  mockGetUserAssignmentCodes.mockResolvedValue({
    isAdmin: !!opts.isAdmin,
    factoryCodes: opts.factoryCodes ?? [],
    corporateCodes: [],
  });
}

beforeEach(() => {
  mockGetUserAssignmentCodes.mockReset();
  mockGetDb.mockReset();
  getDefectTrend.mockClear();
  getDefectPareto.mockClear();
  getMachinePerformance.mockClear();
  generateDailyQualitySummary.mockClear();
  cacheService.clear();
  delete process.env.AI_ANALYTICS_ROLLOUT_PERCENT; // default 100% — every userId in rollout
  delete process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN;
});

afterEach(() => {
  delete process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN;
});

describe("aiInspectionAnalyticsRouter — factory scope (doc69 T3)", () => {
  it("(a) factory-scoped user querying their OWN factory succeeds", async () => {
    mockScope({ factoryCodes: ["F01"] });
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(201, "operator"));

    const result = await caller.defectTrend({ ...period, factoryCode: "F01" });

    expect(result).toHaveLength(1);
    expect(getDefectTrend).toHaveBeenCalledOnce();
    expect((getDefectTrend.mock.calls[0][0] as { factoryCode?: string }).factoryCode).toBe("F01");
  });

  it("(b) the SAME user querying ANOTHER factory is rejected — would have leaked before this task", async () => {
    mockScope({ factoryCodes: ["F01"] });
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(202, "operator"));

    // Before this task, aiInspectionAnalyticsRouter forwarded `factoryCode` straight to
    // the (user-unaware) service with no ownership check — F99's data would have come
    // back unchanged. Proven here two ways: (1) the call is rejected, and (2) the
    // service mock — which itself applies NO user filtering — is never even reached.
    await expect(caller.defectTrend({ ...period, factoryCode: "F99" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(getDefectTrend).not.toHaveBeenCalled();
  });

  it("scoped user with exactly ONE assigned factory + no factoryCode → silently narrowed to it", async () => {
    mockScope({ factoryCodes: ["F01"] });
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(203, "operator"));

    await caller.defectTrend({ ...period });

    expect(getDefectTrend).toHaveBeenCalledOnce();
    expect((getDefectTrend.mock.calls[0][0] as { factoryCode?: string }).factoryCode).toBe("F01");
  });

  it("scoped user with MULTIPLE assigned factories + no factoryCode → FORBIDDEN (ambiguous, never guessed)", async () => {
    mockScope({ factoryCodes: ["F01", "F02"] });
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(204, "supervisor"));

    await expect(caller.defectTrend({ ...period })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDefectTrend).not.toHaveBeenCalled();
  });

  it("(c) a global/admin role is unrestricted — exact input passed through, no narrowing", async () => {
    mockScope({ isAdmin: true });
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(205, "admin"));

    // Admin is never assigned this code anywhere — proves it's genuinely unrestricted,
    // not merely "has a broad assignment list".
    await caller.defectTrend({ ...period, factoryCode: "ANY-FACTORY-NOT-ASSIGNED" });

    expect(getDefectTrend).toHaveBeenCalledOnce();
    expect((getDefectTrend.mock.calls[0][0] as { factoryCode?: string }).factoryCode).toBe(
      "ANY-FACTORY-NOT-ASSIGNED",
    );
  });

  it("scope enforcement applies uniformly to a second endpoint (defectPareto), not just defectTrend", async () => {
    mockScope({ factoryCodes: ["F01"] });
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(206, "operator"));

    await expect(caller.defectPareto({ ...period, factoryCode: "F77" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(getDefectPareto).not.toHaveBeenCalled();
  });

  it("scoped user's machineId outside their factory → FORBIDDEN", async () => {
    mockScope({ factoryCodes: ["F01"] });
    mockGetDb.mockResolvedValue(dbRowsStub([{ code: "F99" }])); // machine 77 belongs to F99
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(207, "operator"));

    await expect(caller.machinePerformance({ ...period, machineId: 77 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(getMachinePerformance).not.toHaveBeenCalled();
  });

  it("scoped user's machineId inside their factory → succeeds", async () => {
    mockScope({ factoryCodes: ["F01"] });
    mockGetDb.mockResolvedValue(dbRowsStub([{ code: "F01" }])); // machine 78 belongs to F01
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(208, "operator"));

    await caller.machinePerformance({ ...period, machineId: 78 });
    expect(getMachinePerformance).toHaveBeenCalledOnce();
  });

  it("(d) exceeding the per-user rate limit returns TOO_MANY_REQUESTS", async () => {
    mockScope({ factoryCodes: ["F01"] });
    process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN = "2";
    const caller = (await importAnalyticsRouter()).createCaller(ctxFor(209, "operator"));

    await caller.defectTrend({ ...period, factoryCode: "F01" }); // 1/2
    await caller.defectTrend({ ...period, factoryCode: "F01" }); // 2/2
    await expect(caller.defectTrend({ ...period, factoryCode: "F01" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("rate limit is per-user — a DIFFERENT user is unaffected by another user's exhausted budget", async () => {
    mockScope({ factoryCodes: ["F01"] });
    process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN = "1";
    const router = await importAnalyticsRouter();
    const callerA = router.createCaller(ctxFor(210, "operator"));
    const callerB = router.createCaller(ctxFor(211, "operator"));

    await callerA.defectTrend({ ...period, factoryCode: "F01" }); // exhausts A's budget
    await expect(callerA.defectTrend({ ...period, factoryCode: "F01" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    await expect(callerB.defectTrend({ ...period, factoryCode: "F01" })).resolves.toBeDefined(); // B still has budget
  });
});

describe("aiReportRouter — factory scope (doc69 T3)", () => {
  it("(a) factory-scoped user with a machineId inside their factory succeeds", async () => {
    mockScope({ factoryCodes: ["F01"] });
    mockGetDb.mockResolvedValue(dbRowsStub([{ code: "F01" }]));
    const caller = (await importReportRouter()).createCaller(ctxFor(301, "operator"));

    await caller.dailySummary({ ...period, machineId: 10 });
    expect(generateDailyQualitySummary).toHaveBeenCalledOnce();
  });

  it("(b) the SAME user's machineId outside their factory is rejected — would have leaked before this task", async () => {
    mockScope({ factoryCodes: ["F01"] });
    mockGetDb.mockResolvedValue(dbRowsStub([{ code: "F99" }]));
    const caller = (await importReportRouter()).createCaller(ctxFor(302, "operator"));

    await expect(caller.dailySummary({ ...period, machineId: 11 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(generateDailyQualitySummary).not.toHaveBeenCalled();
  });

  it("scoped user omitting machineId entirely → FORBIDDEN (service has no factory-level filter to narrow with)", async () => {
    mockScope({ factoryCodes: ["F01"] });
    const caller = (await importReportRouter()).createCaller(ctxFor(303, "operator"));

    await expect(caller.dailySummary({ ...period })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(generateDailyQualitySummary).not.toHaveBeenCalled();
  });

  it("(c) a global/admin role is unrestricted — no machineId required", async () => {
    mockScope({ isAdmin: true });
    const caller = (await importReportRouter()).createCaller(ctxFor(304, "admin"));

    await caller.dailySummary({ ...period });
    expect(generateDailyQualitySummary).toHaveBeenCalledOnce();
    expect(mockGetDb).not.toHaveBeenCalled(); // admin path never needs the machine→factory join
  });

  it("(d) exceeding the per-user rate limit returns TOO_MANY_REQUESTS", async () => {
    mockScope({ isAdmin: true });
    process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN = "1";
    const caller = (await importReportRouter()).createCaller(ctxFor(305, "admin"));

    await caller.dailySummary({ ...period });
    await expect(caller.dailySummary({ ...period })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
