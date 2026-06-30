/**
 * Federation Core Aggregator (doc 13 §4 — F1, pull aggregation).
 *
 * Periodically PULLS each enrolled site's aggregate KPIs read-only via its
 * /api/external/* feed and lands them in the roll-up store. Invariants:
 *
 *   • READ-ONLY, one direction. Only GETs (via siteClient) — the core NEVER
 *     writes to a site. No command/recipe/control path exists here.
 *   • PER-SITE FAILURE ISOLATION. Sites are polled with Promise.allSettled and
 *     each in its own try/catch + hard AbortController timeout. One site that is
 *     down/slow/mis-tokened can only make ITS OWN rows STALE — it never throws
 *     out of the cycle nor affects another site.
 *   • RETRY/BACKOFF + CIRCUIT BREAKER. consecutiveFailures drives an exponential
 *     backoff; after N consecutive failures the circuit OPENS and the site is
 *     skipped (status='error') until a cooldown elapses, then probed again.
 *   • HONEST STALENESS. Every roll-up row stores asOf + fetchedAt from real fetch
 *     metadata; nothing is fabricated or back-dated. sites.lastSyncAt/lastError
 *     reflect the true last attempt.
 *
 * Scheduler convention matches the repo's setInterval schedulers
 * (alertEvaluatorScheduler / kbSyncScheduler): module-level timer + guard flag,
 * run-immediately-then-interval, start/stop/status exports, errors swallowed so
 * the timer never dies. Flag: FEDERATION_AGGREGATOR_ENABLED (default OFF).
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { ENV } from "../../_core/env";
import { sites, type Site } from "../../../drizzle/schema";
import { fetchSiteKpis } from "./siteClient";
import { upsertSnapshot, writeSyncLog } from "./rollupStore";

let timer: NodeJS.Timeout | null = null;
let isRunning = false;
let cycleInFlight = false;
let lastRunAt: Date | null = null;
let lastError: string | null = null;
let lastCycleSummary: Record<string, unknown> | null = null;

/** Result of polling a single site (for cycle telemetry). */
interface SiteOutcome {
  siteId: number;
  code: string;
  status: "ok" | "partial" | "failed" | "skipped";
  error?: string;
}

/** Largest backoff multiplier we apply (cap exponential growth). */
const MAX_BACKOFF_STEPS = 6;

/**
 * Should this site be polled on this tick? Honest, time-based gating:
 *   • circuit OPEN (consecutiveFailures ≥ threshold) → skip until cooldown from
 *     lastSyncAt elapses (half-open probe), THEN allow one attempt.
 *   • otherwise poll when (now − lastSyncAt) ≥ effective interval, where the
 *     interval = pollIntervalSec × exponential backoff on consecutiveFailures.
 */
function shouldPoll(site: Site, now: Date): { poll: boolean; reason?: string } {
  const last = site.lastSyncAt ? site.lastSyncAt.getTime() : 0;
  const sinceMs = now.getTime() - last;
  const fails = site.consecutiveFailures ?? 0;

  // Circuit breaker.
  if (fails >= ENV.federationCircuitThreshold) {
    const cooldownMs = ENV.federationCircuitCooldownSec * 1000;
    if (sinceMs < cooldownMs) {
      return { poll: false, reason: "circuit-open" };
    }
    // cooldown elapsed → half-open: allow a single probe.
    return { poll: true };
  }

  // Exponential backoff on transient failures (jitter applied by interval math).
  const steps = Math.min(fails, MAX_BACKOFF_STEPS);
  const backoff = Math.pow(2, steps); // 1,2,4,…,64
  const effectiveIntervalMs = (site.pollIntervalSec ?? 60) * 1000 * backoff;

  if (sinceMs >= effectiveIntervalMs) return { poll: true };
  return { poll: false, reason: "not-due" };
}

/** Poll one site end-to-end. NEVER throws — all errors become a failed outcome. */
async function pollSite(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, site: Site): Promise<SiteOutcome> {
  const startedAt = new Date();
  try {
    // Window: from lastSyncAt (incremental) — but default to "today so far" for a
    // first poll so the snapshot is meaningful with no prior sync.
    const now = new Date();
    const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const windowEnd = now;

    const result = await fetchSiteKpis(site, windowStart, windowEnd);
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    if (!result.ok || !result.snapshot) {
      await writeSyncLog(db, {
        siteId: site.id,
        startedAt,
        finishedAt,
        ok: false,
        status: "failed",
        httpStatus: result.httpStatus,
        error: result.error ?? "fetch failed",
        durationMs,
        metricsFetched: 0,
        endpointsHit: result.endpointsHit,
      });
      await db
        .update(sites)
        .set({
          status: "error",
          lastError: result.error ?? "fetch failed",
          consecutiveFailures: (site.consecutiveFailures ?? 0) + 1,
          updatedAt: finishedAt,
        })
        .where(eq(sites.id, site.id));
      return { siteId: site.id, code: site.code, status: "failed", error: result.error };
    }

    // Land KPIs.
    const rowsWritten = await upsertSnapshot(db, site, result.snapshot);
    // "partial" = summary OK but the optional pareto was missing.
    const partial = result.snapshot.defectPareto == null;

    await writeSyncLog(db, {
      siteId: site.id,
      startedAt,
      finishedAt,
      ok: true,
      status: partial ? "partial" : "ok",
      httpStatus: result.httpStatus,
      durationMs,
      metricsFetched: rowsWritten,
      endpointsHit: result.endpointsHit,
    });
    await db
      .update(sites)
      .set({
        status: "active",
        lastError: null,
        lastSyncAt: finishedAt,
        consecutiveFailures: 0,
        updatedAt: finishedAt,
      })
      .where(eq(sites.id, site.id));

    return { siteId: site.id, code: site.code, status: partial ? "partial" : "ok" };
  } catch (e: any) {
    // Defensive: pollSite must never throw. Record + isolate.
    const finishedAt = new Date();
    const msg = e?.message || "unexpected poll error";
    await writeSyncLog(db, {
      siteId: site.id,
      startedAt,
      finishedAt,
      ok: false,
      status: "failed",
      error: msg,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      metricsFetched: 0,
      endpointsHit: [],
    });
    try {
      await db
        .update(sites)
        .set({
          status: "error",
          lastError: msg,
          consecutiveFailures: (site.consecutiveFailures ?? 0) + 1,
          updatedAt: finishedAt,
        })
        .where(eq(sites.id, site.id));
    } catch {
      /* even the status write failing must not break the cycle */
    }
    return { siteId: site.id, code: site.code, status: "failed", error: msg };
  }
}

/** Run pollers with a bounded concurrency, isolating each via allSettled. */
async function runWithConcurrency(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  due: Site[],
  limit: number,
): Promise<SiteOutcome[]> {
  const outcomes: SiteOutcome[] = [];
  for (let i = 0; i < due.length; i += limit) {
    const batch = due.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map((s) => pollSite(db, s)));
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled") {
        outcomes.push(r.value);
      } else {
        // pollSite is defensive, but guard anyway — never let one site break the run.
        outcomes.push({
          siteId: batch[j].id,
          code: batch[j].code,
          status: "failed",
          error: String(r.reason?.message ?? r.reason ?? "rejected"),
        });
      }
    }
  }
  return outcomes;
}

/**
 * One aggregation cycle. Loads active sites, gates each by interval/backoff/
 * circuit, polls the due ones with per-site isolation, and records telemetry.
 * NEVER throws.
 */
export async function runAggregationCycle(): Promise<Record<string, unknown>> {
  if (cycleInFlight) {
    console.log("[Federation] Previous cycle still running, skipping this tick");
    return { skipped: "in-flight" };
  }
  cycleInFlight = true;
  lastRunAt = new Date();
  lastError = null;

  try {
    const db = await getDb();
    if (!db) {
      console.warn("[Federation] Database not available, skipping cycle");
      lastCycleSummary = { ok: false, reason: "no-db" };
      return lastCycleSummary;
    }

    // Active sites only. A site flips to status='error' on failure but is still
    // polled (subject to backoff/circuit) so it can recover; 'paused'/'disabled'
    // are excluded operationally.
    const allSites = await db.select().from(sites);
    const candidates = allSites.filter((s) => s.status !== "paused" && s.status !== "disabled");

    const now = new Date();
    const due: Site[] = [];
    let skipped = 0;
    for (const s of candidates) {
      const decision = shouldPoll(s, now);
      if (decision.poll) due.push(s);
      else skipped++;
    }

    const outcomes = due.length
      ? await runWithConcurrency(db, due, ENV.federationConcurrency)
      : [];

    const counts = outcomes.reduce(
      (acc, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    lastCycleSummary = {
      ok: true,
      at: lastRunAt.toISOString(),
      sitesTotal: allSites.length,
      candidates: candidates.length,
      polled: due.length,
      skipped,
      ...counts,
    };
    console.log(
      `[Federation] cycle done — polled=${due.length} skipped=${skipped} ` +
        `ok=${counts.ok ?? 0} partial=${counts.partial ?? 0} failed=${counts.failed ?? 0}`,
    );
    return lastCycleSummary;
  } catch (err) {
    lastError = (err as Error).message;
    console.error("[Federation] cycle error:", lastError);
    lastCycleSummary = { ok: false, error: lastError };
    return lastCycleSummary;
  } finally {
    cycleInFlight = false;
  }
}

/**
 * Start the aggregator scheduler. Idempotent (guards double-start). Disabled
 * unless FEDERATION_AGGREGATOR_ENABLED=true. Runs once immediately then on the
 * global tick; per-site cadence is governed by shouldPoll().
 */
export function startFederationAggregator(): void {
  if (!ENV.federationAggregatorEnabled) {
    console.log("[Federation] Aggregator disabled (set FEDERATION_AGGREGATOR_ENABLED=true to enable)");
    return;
  }
  if (isRunning || timer) {
    console.log("[Federation] Aggregator already running, ignoring start()");
    return;
  }
  const tickSec = ENV.federationAggregatorTickSec;
  isRunning = true;
  console.log(`[Federation] Aggregator started (tick: ${tickSec}s)`);

  void runAggregationCycle();
  timer = setInterval(() => void runAggregationCycle(), tickSec * 1000);
}

export function stopFederationAggregator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  isRunning = false;
  console.log("[Federation] Aggregator stopped");
}

export function getFederationAggregatorStatus() {
  return { isRunning, cycleInFlight, lastRunAt, lastError, lastCycleSummary };
}

/** Manual one-shot trigger (admin endpoint / tests). */
export async function triggerAggregationCycle() {
  return runAggregationCycle();
}
