/**
 * Query Performance Monitor — doc 27 Đợt 4 / W4-A (gap B1, P1).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BEFORE: this file was dead code — `logQueryMetrics` existed but nothing ever
 * called it, so the admin "slow query" pages always showed zero. It also stored
 * raw query params (PII risk) and kept every query in an unbounded-ish array.
 *
 * NOW: `instrumentPostgresClient()` is wired into the ONE postgres-js client
 * drizzle uses (server/db/connection.ts). It patches `client.unsafe` — the
 * single funnel drizzle-orm/postgres-js sends every query through — plus
 * `begin`/`savepoint` so transaction-scoped clients are covered too. Timing is
 * measured from the first `.then()` invocation (the exact moment postgres-js
 * lazily dispatches the query) to settle, i.e. honest app-observed latency
 * including pool-queue wait.
 *
 * DESIGN (near-zero overhead when healthy):
 *   • Per-query cost: a couple of counters + one cached normalization lookup +
 *     one aggregate update. No allocation of history entries for fast queries.
 *   • Only queries ≥ SLOW_QUERY_MS (default 200) are stored individually, in a
 *     fixed-size ring buffer (last QUERY_MONITOR_RING_SIZE, default 200).
 *   • Per-normalized-query aggregates (count/total/avg/max/slowCount) live in a
 *     hard-capped LRU map (QUERY_MONITOR_MAX_PATTERNS, default 500).
 *   • NO parameter values are ever stored: drizzle SQL text is parameterized
 *     ($1…$n) and normalization additionally strips string/number literals from
 *     any raw SQL — no PII in memory or logs.
 *   • Kill switch: QUERY_MONITOR_ENABLED=false skips client patching entirely
 *     (true zero overhead) and turns recordQuery into a no-op.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ── env (read dynamically so tests / ops can toggle without rebuild) ─────────

export function isQueryMonitorEnabled(): boolean {
  const v = process.env.QUERY_MONITOR_ENABLED;
  return !(v === "false" || v === "0");
}

export function slowQueryThresholdMs(): number {
  const n = Number(process.env.SLOW_QUERY_MS ?? 200);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

function ringCapacity(): number {
  const n = Number(process.env.QUERY_MONITOR_RING_SIZE ?? 200);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 5000) : 200;
}

function maxPatterns(): number {
  const n = Number(process.env.QUERY_MONITOR_MAX_PATTERNS ?? 500);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 5000) : 500;
}

// ── types ────────────────────────────────────────────────────────────────────

export interface SlowQueryEntry {
  /** Normalized SQL text — literals/params stripped, truncated. Never raw params. */
  query: string;
  executionTime: number; // ms
  timestamp: Date;
  isSlowQuery: true;
  error: boolean;
}

export interface QueryAggregate {
  query: string; // normalized
  count: number;
  totalTime: number; // ms
  avgTime: number; // ms
  maxTime: number; // ms
  slowCount: number;
  errorCount: number;
  lastSeen: Date;
}

// ── state (bounded) ──────────────────────────────────────────────────────────

let totalQueries = 0;
let totalErrors = 0;
let cumulativeSlow = 0;
let sumDurationMs = 0;
let maxDurationMs = 0;
let minDurationMs = Number.POSITIVE_INFINITY;

let ringCap = ringCapacity();
let slowRing: SlowQueryEntry[] = [];
let slowRingWrite = 0;

/** normalized query → aggregate; Map insertion order used as LRU (delete+set on touch). */
const aggregates = new Map<string, QueryAggregate>();

/** raw SQL text → normalized text cache (drizzle re-emits identical strings). */
const normalizeCache = new Map<string, string>();
const NORMALIZE_CACHE_CAP = 500;
const NORMALIZE_CACHE_MAX_KEY = 5000;

// ── normalization (no PII: strips literals; params are never stored at all) ──

const MAX_NORMALIZED_LEN = 300;

export function normalizeSqlForMonitor(sql: string): string {
  const cached = normalizeCache.get(sql);
  if (cached !== undefined) return cached;

  let s = sql.replace(/\s+/g, " ").trim();
  // string literals (incl. '' escapes) → '?'
  s = s.replace(/'(?:[^']|'')*'/g, "'?'");
  // positional params $1..$n → $?
  s = s.replace(/\$\d+/g, "$?");
  // bare numeric literals → 0 (identifiers like col1 keep their digits — no \b between word chars)
  s = s.replace(/\b\d+(?:\.\d+)?\b/g, "0");
  // collapse IN (...) lists of placeholders/literals → IN (…)
  s = s.replace(/\bin\s*\(\s*(?:\$\?|0|'\?')(?:\s*,\s*(?:\$\?|0|'\?'))*\s*\)/gi, "in (…)");
  if (s.length > MAX_NORMALIZED_LEN) s = `${s.slice(0, MAX_NORMALIZED_LEN)} …`;

  if (sql.length <= NORMALIZE_CACHE_MAX_KEY) {
    if (normalizeCache.size >= NORMALIZE_CACHE_CAP) {
      const oldest = normalizeCache.keys().next().value;
      if (oldest !== undefined) normalizeCache.delete(oldest);
    }
    normalizeCache.set(sql, s);
  }
  return s;
}

// ── recorder ─────────────────────────────────────────────────────────────────

export function recordQuery(
  rawSql: string,
  durationMs: number,
  opts?: { error?: boolean },
): void {
  if (!isQueryMonitorEnabled()) return;
  const isError = opts?.error === true;

  totalQueries++;
  if (isError) totalErrors++;
  sumDurationMs += durationMs;
  if (durationMs > maxDurationMs) maxDurationMs = durationMs;
  if (durationMs < minDurationMs) minDurationMs = durationMs;

  const normalized = normalizeSqlForMonitor(rawSql);
  const isSlow = durationMs >= slowQueryThresholdMs();
  const now = new Date();

  // aggregate (LRU touch = delete + set)
  let agg = aggregates.get(normalized);
  if (agg) {
    aggregates.delete(normalized);
  } else {
    if (aggregates.size >= maxPatterns()) {
      const oldest = aggregates.keys().next().value;
      if (oldest !== undefined) aggregates.delete(oldest);
    }
    agg = {
      query: normalized,
      count: 0,
      totalTime: 0,
      avgTime: 0,
      maxTime: 0,
      slowCount: 0,
      errorCount: 0,
      lastSeen: now,
    };
  }
  agg.count++;
  agg.totalTime += durationMs;
  agg.avgTime = agg.totalTime / agg.count;
  if (durationMs > agg.maxTime) agg.maxTime = durationMs;
  if (isSlow) agg.slowCount++;
  if (isError) agg.errorCount++;
  agg.lastSeen = now;
  aggregates.set(normalized, agg);

  if (isSlow) {
    cumulativeSlow++;
    const entry: SlowQueryEntry = {
      query: normalized,
      executionTime: durationMs,
      timestamp: now,
      isSlowQuery: true,
      error: isError,
    };
    slowRing[slowRingWrite % ringCap] = entry;
    slowRingWrite++;
    console.warn(
      `[SLOW QUERY] ${durationMs.toFixed(1)}ms${isError ? " [ERROR]" : ""}: ${normalized.slice(0, 200)}`,
    );
  }
}

// ── client instrumentation (drizzle-orm/postgres-js funnels via client.unsafe) ─

const INSTRUMENTED = Symbol.for("st4i.queryMonitor.instrumented");

/**
 * Patch a postgres-js client (or transaction/savepoint sub-client) so every
 * query flowing through `unsafe` is timed and fed to `recordQuery`. Preserves
 * postgres-js Query semantics exactly: laziness (nothing executes until first
 * `.then`), and `.values()` / `.raw()` chaining (they mutate + return the same
 * instance, which keeps the patched `then`). No-op when the monitor is disabled
 * or the client is already patched.
 */
export function instrumentPostgresClient<T extends object>(client: T): T {
  if (!isQueryMonitorEnabled()) return client;
  const c = client as Record<PropertyKey, unknown>;
  if (c[INSTRUMENTED]) return client;
  c[INSTRUMENTED] = true;

  if (typeof c.unsafe === "function") {
    const origUnsafe = (c.unsafe as (...a: unknown[]) => unknown).bind(client);
    c.unsafe = (query: string, params?: unknown[], options?: unknown) => {
      const pending = origUnsafe(query, params, options);
      return attachTiming(pending, query);
    };
  }

  // drizzle transactions: client.begin(fn) / txClient.savepoint(fn) hand a
  // scoped sub-client to the callback — instrument it too so tx queries count.
  for (const method of ["begin", "savepoint"] as const) {
    if (typeof c[method] === "function") {
      const orig = (c[method] as (...a: unknown[]) => unknown).bind(client);
      c[method] = (...args: unknown[]) => {
        const idx = args.findIndex((a) => typeof a === "function");
        if (idx >= 0) {
          const fn = args[idx] as (tx: object) => unknown;
          args[idx] = (tx: object) => fn(instrumentPostgresClient(tx));
        }
        return orig(...args);
      };
    }
  }

  return client;
}

/** Wrap a lazy postgres-js Query's `then` so we time first-dispatch → settle. */
function attachTiming(pending: unknown, queryText: string): unknown {
  if (
    pending == null ||
    (typeof pending !== "object" && typeof pending !== "function") ||
    typeof (pending as { then?: unknown }).then !== "function"
  ) {
    return pending;
  }
  const p = pending as { then: (...a: unknown[]) => unknown };
  const origThen = p.then.bind(p);
  let startedAt = 0;
  let recorded = false;
  const settle = (isError: boolean) => {
    if (recorded) return;
    recorded = true;
    recordQuery(queryText, performance.now() - startedAt, { error: isError });
  };
  p.then = function patchedThen(onFulfilled?: unknown, onRejected?: unknown) {
    if (startedAt === 0) startedAt = performance.now();
    return origThen(
      (value: unknown) => {
        settle(false);
        return typeof onFulfilled === "function" ? onFulfilled(value) : value;
      },
      (err: unknown) => {
        settle(true);
        if (typeof onRejected === "function") return onRejected(err);
        throw err;
      },
    );
  };
  return pending;
}

// ── read API (system router + system-health surface) ─────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Last N slow queries (newest first) from the ring buffer. */
export function getSlowQueries(limit = 50): SlowQueryEntry[] {
  const stored = Math.min(slowRingWrite, ringCap);
  const out: SlowQueryEntry[] = [];
  for (let i = 1; i <= stored && out.length < limit; i++) {
    const entry = slowRing[(slowRingWrite - i) % ringCap];
    if (entry) out.push(entry);
  }
  return out;
}

/** Headline counters — cheap O(1) snapshot. */
export function getQueryStats() {
  return {
    enabled: isQueryMonitorEnabled(),
    thresholdMs: slowQueryThresholdMs(),
    totalQueries,
    slowQueries: cumulativeSlow,
    errorCount: totalErrors,
    slowQueryPercentage: totalQueries === 0 ? 0 : round2((cumulativeSlow / totalQueries) * 100),
    averageExecutionTime: totalQueries === 0 ? 0 : round2(sumDurationMs / totalQueries),
    maxExecutionTime: round2(maxDurationMs),
    minExecutionTime: Number.isFinite(minDurationMs) ? round2(minDurationMs) : 0,
    patternsTracked: aggregates.size,
  };
}

/** All tracked patterns, heaviest total time first (admin "patterns" tab). */
export function analyzeQueryPatterns(limit = 20): QueryAggregate[] {
  return [...aggregates.values()]
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, limit)
    .map((a) => ({ ...a, totalTime: round2(a.totalTime), avgTime: round2(a.avgTime), maxTime: round2(a.maxTime) }));
}

/** Top offending patterns that actually crossed the slow threshold (health card). */
export function getTopSlowQueries(limit = 10): QueryAggregate[] {
  return [...aggregates.values()]
    .filter((a) => a.slowCount > 0)
    .sort((a, b) => b.maxTime - a.maxTime)
    .slice(0, limit)
    .map((a) => ({ ...a, totalTime: round2(a.totalTime), avgTime: round2(a.avgTime), maxTime: round2(a.maxTime) }));
}

/** Reset all counters/buffers (admin "clear history" + tests). Re-reads env caps. */
export function clearMetricsHistory(): void {
  totalQueries = 0;
  totalErrors = 0;
  cumulativeSlow = 0;
  sumDurationMs = 0;
  maxDurationMs = 0;
  minDurationMs = Number.POSITIVE_INFINITY;
  ringCap = ringCapacity();
  slowRing = [];
  slowRingWrite = 0;
  aggregates.clear();
  normalizeCache.clear();
}
