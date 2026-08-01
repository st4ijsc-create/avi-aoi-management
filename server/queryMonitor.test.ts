/**
 * W4-A (doc 27 gap B1) — query monitor unit tests:
 *   • threshold-only recording (ring holds only slow queries)
 *   • normalization strips string/number literals + positional params (no PII)
 *   • ring buffer hard cap + aggregate LRU hard cap (bounded memory)
 *   • kill switch QUERY_MONITOR_ENABLED=false
 *   • instrumentPostgresClient: times unsafe() queries, preserves .values()
 *     chaining and laziness, covers begin() transaction sub-clients, records
 *     errors, and is a no-op when disabled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordQuery,
  normalizeSqlForMonitor,
  getSlowQueries,
  getQueryStats,
  analyzeQueryPatterns,
  getTopSlowQueries,
  clearMetricsHistory,
  instrumentPostgresClient,
  isQueryMonitorEnabled,
} from "./queryMonitor";

const ENV_KEYS = [
  "QUERY_MONITOR_ENABLED",
  "SLOW_QUERY_MS",
  "QUERY_MONITOR_RING_SIZE",
  "QUERY_MONITOR_MAX_PATTERNS",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  clearMetricsHistory();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  clearMetricsHistory();
  vi.restoreAllMocks();
});

// ── normalization (no PII) ───────────────────────────────────────────────────

describe("normalizeSqlForMonitor", () => {
  it("strips string literals (incl. '' escapes)", () => {
    const s = normalizeSqlForMonitor(
      "select * from users where email = 'a@b.com' and note = 'O''Brien secret'",
    );
    expect(s).not.toContain("a@b.com");
    expect(s).not.toContain("Brien");
    expect(s).toContain("'?'");
  });

  it("collapses positional params and bare numbers, keeps identifiers with digits", () => {
    const s = normalizeSqlForMonitor(
      'select col1, "field2" from t where id = $1 and age > 42 and score = 3.14',
    );
    expect(s).toContain("$?");
    expect(s).not.toMatch(/\b42\b/);
    expect(s).not.toContain("3.14");
    expect(s).toContain("col1");
    expect(s).toContain('"field2"');
  });

  it("collapses IN lists and whitespace, truncates long text", () => {
    const inList = normalizeSqlForMonitor("select * from t where id in ($1, $2,   $3)");
    expect(inList).toContain("in (…)");
    const long = normalizeSqlForMonitor(`select ${"x".repeat(1000)} from t`);
    expect(long.length).toBeLessThanOrEqual(310);
    expect(long.endsWith("…")).toBe(true);
  });
});

// ── recorder: threshold + bounds ─────────────────────────────────────────────

describe("recordQuery", () => {
  it("stores only queries at/over SLOW_QUERY_MS in the ring; aggregates everything", () => {
    process.env.SLOW_QUERY_MS = "200";
    recordQuery("select * from fast", 5);
    recordQuery("select * from slow", 250);
    recordQuery("select * from slow", 300);

    const slow = getSlowQueries(10);
    expect(slow).toHaveLength(2);
    expect(slow[0].executionTime).toBe(300); // newest first
    expect(slow.every((e) => e.query.includes("slow"))).toBe(true);

    const stats = getQueryStats();
    expect(stats.totalQueries).toBe(3);
    expect(stats.slowQueries).toBe(2);
    expect(stats.maxExecutionTime).toBe(300);
    expect(stats.minExecutionTime).toBe(5);

    const patterns = analyzeQueryPatterns(10);
    expect(patterns).toHaveLength(2); // both patterns aggregated
    const slowAgg = patterns.find((p) => p.query.includes("slow"))!;
    expect(slowAgg.count).toBe(2);
    expect(slowAgg.avgTime).toBe(275);
    expect(slowAgg.maxTime).toBe(300);
    expect(slowAgg.slowCount).toBe(2);
  });

  it("topSlow only returns patterns that actually crossed the threshold", () => {
    process.env.SLOW_QUERY_MS = "200";
    recordQuery("select * from fast", 10);
    recordQuery("select * from slow", 500);
    const top = getTopSlowQueries(10);
    expect(top).toHaveLength(1);
    expect(top[0].query).toContain("slow");
  });

  it("ring buffer is hard-capped (keeps newest)", () => {
    process.env.SLOW_QUERY_MS = "0";
    process.env.QUERY_MONITOR_RING_SIZE = "5";
    clearMetricsHistory(); // re-read caps
    for (let i = 1; i <= 12; i++) recordQuery(`select ${"pad".repeat(i)} from t`, i);
    const slow = getSlowQueries(100);
    expect(slow).toHaveLength(5);
    expect(slow[0].executionTime).toBe(12);
    expect(slow[4].executionTime).toBe(8);
  });

  it("aggregate map is hard-capped with LRU eviction", () => {
    process.env.SLOW_QUERY_MS = "1000000";
    process.env.QUERY_MONITOR_MAX_PATTERNS = "3";
    clearMetricsHistory();
    recordQuery("select a from t1", 1);
    recordQuery("select b from t2", 1);
    recordQuery("select c from t3", 1);
    recordQuery("select a from t1", 1); // touch t1 → t2 becomes oldest
    recordQuery("select d from t4", 1); // evicts t2
    const patterns = analyzeQueryPatterns(10).map((p) => p.query);
    expect(patterns).toHaveLength(3);
    expect(patterns.some((q) => q.includes("t2"))).toBe(false);
    expect(patterns.some((q) => q.includes("t1"))).toBe(true);
  });

  it("never stores parameter values — entries hold normalized text only", () => {
    process.env.SLOW_QUERY_MS = "0";
    recordQuery("update users set ssn = '123-45-6789' where id = 77", 10);
    const [entry] = getSlowQueries(1);
    expect(entry.query).not.toContain("123-45-6789");
    expect(entry.query).not.toMatch(/\b77\b/);
    expect(Object.keys(entry)).not.toContain("params");
  });

  it("kill switch: QUERY_MONITOR_ENABLED=false makes recordQuery a no-op", () => {
    process.env.QUERY_MONITOR_ENABLED = "false";
    expect(isQueryMonitorEnabled()).toBe(false);
    recordQuery("select 1", 999);
    process.env.QUERY_MONITOR_ENABLED = "true";
    expect(getQueryStats().totalQueries).toBe(0);
  });
});

// ── client instrumentation ───────────────────────────────────────────────────

/** Minimal stand-in for a lazy postgres-js Query: executes on first .then(). */
function makeFakePending(opts: { result?: unknown; fail?: boolean } = {}) {
  const state = { executed: false, valuesMode: false };
  const pending: any = {
    values() {
      state.valuesMode = true;
      return pending;
    },
    then(onFulfilled?: any, onRejected?: any) {
      state.executed = true;
      const base = opts.fail
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(opts.result ?? [{ ok: 1 }]);
      return base.then(onFulfilled, onRejected);
    },
  };
  return { pending, state };
}

function makeFakeClient(opts: { fail?: boolean } = {}) {
  const states: Array<{ executed: boolean; valuesMode: boolean }> = [];
  const client: any = {
    unsafe: (_q: string, _p?: unknown[]) => {
      const { pending, state } = makeFakePending(opts);
      states.push(state);
      return pending;
    },
    begin: async (fnOrOpts: unknown, maybeFn?: unknown) => {
      const fn = (typeof fnOrOpts === "function" ? fnOrOpts : maybeFn) as (tx: any) => unknown;
      const tx: any = {
        unsafe: (_q: string) => {
          const { pending, state } = makeFakePending(opts);
          states.push(state);
          return pending;
        },
      };
      return fn(tx);
    },
  };
  return { client, states };
}

describe("instrumentPostgresClient", () => {
  it("times queries through unsafe() and records them (threshold 0 → all slow)", async () => {
    process.env.SLOW_QUERY_MS = "0";
    const { client } = makeFakeClient();
    instrumentPostgresClient(client);
    const rows = await client.unsafe("select secret from t where k = 'v'", []);
    expect(rows).toEqual([{ ok: 1 }]);
    const stats = getQueryStats();
    expect(stats.totalQueries).toBe(1);
    const [entry] = getSlowQueries(1);
    expect(entry.query).toContain("select secret from t");
    expect(entry.query).not.toContain("'v'");
    expect(entry.error).toBe(false);
  });

  it("preserves .values() chaining and laziness (no eager execution)", async () => {
    process.env.SLOW_QUERY_MS = "0";
    const { client, states } = makeFakeClient();
    instrumentPostgresClient(client);
    const q = client.unsafe("select 1", []);
    expect(states[0].executed).toBe(false); // patched but NOT executed yet
    const chained = q.values();
    expect(chained).toBe(q); // same instance, values-mode set
    expect(states[0].valuesMode).toBe(true);
    await chained;
    expect(states[0].executed).toBe(true);
    expect(getQueryStats().totalQueries).toBe(1);
  });

  it("records failed queries with the error flag and rethrows", async () => {
    process.env.SLOW_QUERY_MS = "0";
    const { client } = makeFakeClient({ fail: true });
    instrumentPostgresClient(client);
    await expect(client.unsafe("select * from broken", [])).rejects.toThrow("boom");
    const stats = getQueryStats();
    expect(stats.totalQueries).toBe(1);
    expect(stats.errorCount).toBe(1);
    expect(getSlowQueries(1)[0].error).toBe(true);
  });

  it("instruments transaction sub-clients handed out by begin()", async () => {
    process.env.SLOW_QUERY_MS = "0";
    const { client } = makeFakeClient();
    instrumentPostgresClient(client);
    await client.begin(async (tx: any) => tx.unsafe("insert into t values ($1)", [1]));
    expect(getQueryStats().totalQueries).toBe(1);
    expect(getSlowQueries(1)[0].query).toContain("insert into t");
  });

  it("records a single measurement even if then() is invoked twice", async () => {
    process.env.SLOW_QUERY_MS = "0";
    const { client } = makeFakeClient();
    instrumentPostgresClient(client);
    const q = client.unsafe("select 1", []);
    await q;
    await q.then((x: unknown) => x);
    expect(getQueryStats().totalQueries).toBe(1);
  });

  it("does not patch the client when the monitor is disabled", () => {
    process.env.QUERY_MONITOR_ENABLED = "false";
    const { client } = makeFakeClient();
    const origUnsafe = client.unsafe;
    instrumentPostgresClient(client);
    expect(client.unsafe).toBe(origUnsafe);
  });

  it("is idempotent — double instrumentation does not double-record", async () => {
    process.env.SLOW_QUERY_MS = "0";
    const { client } = makeFakeClient();
    instrumentPostgresClient(client);
    instrumentPostgresClient(client);
    await client.unsafe("select 1", []);
    expect(getQueryStats().totalQueries).toBe(1);
  });
});
