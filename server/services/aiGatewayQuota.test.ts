/**
 * doc69 G2-4 — per-user/role daily (rolling 24h) AI token quota — resolution logic.
 *
 * Proves `resolveQuotaBudget` / `getTokensUsedToday` / `checkQuota` (server/services/
 * aiGatewayQuota.ts) resolve budgets in the documented order (user → role → deployment
 * default row → env default), read usage correctly, and are fail-safe (never throw; any DB
 * error degrades to "allow"/env-default rather than blocking inference).
 *
 * `../db/connection` is mocked with a minimal thenable query-builder stub mirroring drizzle's
 * chainable `.select().from().where().limit()` shape (see aiSafetyGateway.test.ts for the same
 * `getDb` mocking pattern used elsewhere in this codebase). `../../drizzle/schema` and
 * `drizzle-orm` are the REAL modules — both are pure builders/definitions, no I/O.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getDbMock = vi.fn();
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

/** Minimal thenable query-builder stub mirroring drizzle's `.select().from().where().limit()`. */
function makeResult(rows: unknown[]) {
  const builder: PromiseLike<unknown[]> & Record<string, unknown> = {
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown[]) => void) => resolve(rows),
  } as any;
  return builder;
}

async function loadFresh() {
  vi.resetModules();
  return import("./aiGatewayQuota");
}

const ENV_KEYS = ["AI_QUOTA_DEFAULT_DAILY_TOKENS"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("aiGatewayQuota.resolveQuotaBudget", () => {
  it("returns the per-user row when one exists (highest priority, no further lookups)", async () => {
    const selectMock = vi.fn().mockReturnValueOnce(makeResult([{ id: 1, dailyTokenBudget: 5000 }]));
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const budget = await quota.resolveQuotaBudget(42);
    expect(budget).toEqual({ budgetTokens: 5000, source: "user", quotaRowId: 1 });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("falls through to the role row when no per-user row exists", async () => {
    const selectMock = vi
      .fn()
      .mockReturnValueOnce(makeResult([])) // user
      .mockReturnValueOnce(makeResult([{ id: 2, dailyTokenBudget: 8000 }])); // role
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const budget = await quota.resolveQuotaBudget(42, "operator");
    expect(budget).toEqual({ budgetTokens: 8000, source: "role", quotaRowId: 2 });
  });

  it("falls through to the deployment-wide default row when neither user nor role match", async () => {
    const selectMock = vi
      .fn()
      .mockReturnValueOnce(makeResult([]))
      .mockReturnValueOnce(makeResult([]))
      .mockReturnValueOnce(makeResult([{ id: 3, dailyTokenBudget: 9000 }]));
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const budget = await quota.resolveQuotaBudget(42, "operator");
    expect(budget).toEqual({ budgetTokens: 9000, source: "default-row", quotaRowId: 3 });
  });

  it("falls back to AI_QUOTA_DEFAULT_DAILY_TOKENS (env) when nothing is configured in the table", async () => {
    process.env.AI_QUOTA_DEFAULT_DAILY_TOKENS = "12345";
    const selectMock = vi.fn().mockReturnValue(makeResult([]));
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const budget = await quota.resolveQuotaBudget(42);
    expect(budget).toEqual({ budgetTokens: 12345, source: "env-default", quotaRowId: null });
  });

  it("uses the built-in default (200000) when AI_QUOTA_DEFAULT_DAILY_TOKENS is unset", async () => {
    const selectMock = vi.fn().mockReturnValue(makeResult([]));
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const budget = await quota.resolveQuotaBudget(42);
    expect(budget.budgetTokens).toBe(200_000);
    expect(budget.source).toBe("env-default");
  });

  it("fail-safe: DB error → env default, never throws", async () => {
    getDbMock.mockRejectedValue(new Error("db down"));
    const quota = await loadFresh();

    const budget = await quota.resolveQuotaBudget(42);
    expect(budget.source).toBe("env-default");
    expect(budget.budgetTokens).toBe(200_000);
  });

  it("fail-safe: no DB configured (getDb → null, e.g. tests/offline) → env default", async () => {
    getDbMock.mockResolvedValue(null);
    const quota = await loadFresh();

    const budget = await quota.resolveQuotaBudget(42);
    expect(budget.source).toBe("env-default");
  });
});

describe("aiGatewayQuota.getTokensUsedToday", () => {
  it("reads the rolling-24h sum from ai_gateway_metrics", async () => {
    const selectMock = vi.fn().mockReturnValueOnce(makeResult([{ used: 7777 }]));
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const used = await quota.getTokensUsedToday(42);
    expect(used).toBe(7777);
  });

  it("returns 0 when there are no rows (honest-empty, not an error)", async () => {
    const selectMock = vi.fn().mockReturnValueOnce(makeResult([]));
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const used = await quota.getTokensUsedToday(42);
    expect(used).toBe(0);
  });

  it("fail-safe: DB error → 0 used, never throws", async () => {
    getDbMock.mockRejectedValue(new Error("db down"));
    const quota = await loadFresh();

    const used = await quota.getTokensUsedToday(42);
    expect(used).toBe(0);
  });
});

describe("aiGatewayQuota.checkQuota", () => {
  it("returns null for a caller with no userId (anon/system — nothing to enforce)", async () => {
    const quota = await loadFresh();
    const result = await quota.checkQuota(undefined);
    expect(result).toBeNull();
  });

  it("allowed:false when usage >= the admin-configured per-user budget", async () => {
    const selectMock = vi
      .fn()
      .mockReturnValueOnce(makeResult([{ id: 1, dailyTokenBudget: 1000 }])) // resolveQuotaBudget → user row
      .mockReturnValueOnce(makeResult([{ used: 1500 }])); // getTokensUsedToday
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const result = await quota.checkQuota(42);
    expect(result).toEqual({ allowed: false, usedTokens: 1500, budgetTokens: 1000, source: "user" });
  });

  it("allowed:true when usage is under the budget", async () => {
    const selectMock = vi
      .fn()
      .mockReturnValueOnce(makeResult([{ id: 1, dailyTokenBudget: 1000 }]))
      .mockReturnValueOnce(makeResult([{ used: 200 }]));
    getDbMock.mockResolvedValue({ select: selectMock });
    const quota = await loadFresh();

    const result = await quota.checkQuota(42);
    expect(result?.allowed).toBe(true);
    expect(result?.usedTokens).toBe(200);
  });

  it("fail-safe: a DB error never throws — degrades to the env-default budget vs 0 used (allowed)", async () => {
    getDbMock.mockRejectedValue(new Error("db down"));
    const quota = await loadFresh();

    // resolveQuotaBudget/getTokensUsedToday are individually fail-safe (env-default/0 used),
    // so checkQuota still resolves to a real comparison here (not null) — but it never throws,
    // and a DB outage can never manufacture an over-budget denial.
    const result = await quota.checkQuota(42);
    expect(result).not.toBeNull();
    expect(result?.allowed).toBe(true); // 0 used < env-default budget
  });
});
