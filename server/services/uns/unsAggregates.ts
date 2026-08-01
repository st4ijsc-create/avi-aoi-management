/**
 * doc 44 W2-A1 / G2.3 — UNS aggregate nodes `_line` / `_area` / `_site`
 * (SYNAPSE LDS-L2 §4.1 + §7.2 "tính phái sinh ... phát lên node _line").
 *
 * Periodic derived-metric publisher: per production line it computes throughput,
 * NG rate and provisional OEE over a trailing window and publishes a RETAINED
 * StateSnapshot-shaped payload to
 *
 *   syn/{site}/{area}/{line}/_line/state       (retained, QoS 1)
 *   syn/{site}/{area}/_area/state              (workshop rollup)
 *   syn/{site}/_site/state                     (factory rollup)
 *
 * SEMANTIC-LAYER PRINCIPLE (LDS-L2 §9): the OEE math is NOT re-derived here —
 * per-line numbers come from the ONE canonical definition,
 * `oeeService.getLineOEE` (SEMI E10 / ISO 22400, honest-null). Area/site
 * rollups re-apply the SAME accumulation getLineOEE itself uses for
 * availability (Σonline/(Σonline+Σoffline)) and quality (Σgood/Σtotal) from the
 * line details it exposes; performance/OEE need per-machine ideal-cycle inputs
 * that getLineOEE does NOT expose at the line grain, so at area/site they are
 * published as null with `partial: true` — HONEST partial, never re-invented.
 *
 * Isolation: each line/area/site node is computed+published in its own
 * try/catch — one failure never blocks the others. A run never throws.
 *
 * Flags/env (all default OFF/safe):
 *   UNS_AGGREGATES_ENABLED       "true" to start the scheduler (default OFF)
 *   UNS_AGGREGATES_INTERVAL_MS   tick interval (default 60000)
 *   UNS_AGGREGATES_WINDOW_MS     trailing metric window (default 3600000 = 1h)
 *
 * The scheduler is started by unsPublisher.initUnsPublisher (dynamic import) —
 * publishing rides the SAME shared UNS client (publishUnsV2), so it also
 * requires UNS_BRIDGE_ENABLED + a live broker connection to actually emit.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { executeRows } from "../../utils/kpi";
import { getLineOEE, type LineOEEMetrics } from "../oeeService";
import { publishUnsV2 } from "../unsPublisher";
import {
  slugSegment,
  buildLineAggregateTopicV2,
  buildAreaAggregateTopicV2,
  buildSiteAggregateTopicV2,
} from "./topicV2";

// ─── Flags / tunables (read at call time — test-friendly) ─────────────────────

export function isUnsAggregatesEnabled(): boolean {
  return process.env.UNS_AGGREGATES_ENABLED === "true";
}

function intervalMs(): number {
  const n = Number(process.env.UNS_AGGREGATES_INTERVAL_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 60_000;
}

function windowMs(): number {
  const n = Number(process.env.UNS_AGGREGATES_WINDOW_MS);
  return Number.isFinite(n) && n >= 60_000 ? n : 60 * 60 * 1000;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineHierarchy {
  lineId: number;
  lineCode: string;
  workshopId: number;
  workshopCode: string;
  factoryId: number;
  factoryCode: string;
}

export interface UnsAggregatesRunStats {
  lines: number;
  areas: number;
  sites: number;
  published: number;
  skipped: number; // line without hierarchy row / publisher not connected
  errors: number;
  windowFrom: string;
  windowTo: string;
  ms: number;
}

// ─── Module state ─────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastRunStats: UnsAggregatesRunStats | null = null;

// ─── Payload builders ─────────────────────────────────────────────────────────

/** Round to 2 decimals (percent values already 0..100 from oeeService). */
function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * `_line/state` payload — StateSnapshot-shaped (canonical state.schema.json
 * requires {path, ts, state}; extra fields are BACKWARD-safe additions).
 * state: EXECUTE when the line produced in the window, IDLE otherwise (a
 * derived-node state, documented — not a physical machine state).
 */
function buildLineNodePayload(
  lm: LineOEEMetrics,
  segs: { site: string; area: string; line: string },
  win: { from: Date; to: Date },
): Record<string, unknown> {
  const d = lm.details;
  const windowHours = (win.to.getTime() - win.from.getTime()) / 3_600_000;
  const ngRate = d.totalCount > 0 ? r2((d.rejectCount / d.totalCount) * 100) : null;
  return {
    path: `${segs.site}/${segs.area}/${segs.line}/_line`,
    ts: new Date().toISOString(),
    state: d.totalCount > 0 ? "EXECUTE" : "IDLE",
    values: {
      throughput_units: d.totalCount,
      throughput_per_hour: windowHours > 0 ? r2(d.totalCount / windowHours) : null,
      ng_rate_pct: ngRate,
      oee_pct: lm.oee,
      availability_pct: lm.availability,
      performance_pct: lm.performance,
      quality_pct: lm.quality,
      machine_count: d.machineCount,
      good_count: d.goodCount,
      reject_count: d.rejectCount,
    },
    window: { from: win.from.toISOString(), to: win.to.toISOString() },
    metric_source: "oeeService.getLineOEE",
    // Honest partial marker: some factor inputs were absent (oeeService
    // returned null rather than fabricating a number).
    partial: lm.oee === null,
  };
}

/** Accumulator for area (workshop) / site (factory) rollups from line details. */
interface RollupAcc {
  lineCount: number;
  machineCount: number;
  online: number;
  offline: number;
  total: number;
  good: number;
  reject: number;
}

function emptyAcc(): RollupAcc {
  return { lineCount: 0, machineCount: 0, online: 0, offline: 0, total: 0, good: 0, reject: 0 };
}

function accumulate(acc: RollupAcc, lm: LineOEEMetrics): void {
  const d = lm.details;
  acc.lineCount += 1;
  acc.machineCount += d.machineCount;
  acc.online += d.onlineSeconds;
  acc.offline += d.offlineSeconds;
  acc.total += d.totalCount;
  acc.good += d.goodCount;
  acc.reject += d.rejectCount;
}

/**
 * `_area` / `_site` rollup payload. Availability/quality re-apply the SAME
 * accumulation formula the canonical service uses; performance/OEE are null +
 * partial (their per-machine inputs are not exposed at the line grain — honest,
 * not re-derived here).
 */
function buildRollupPayload(
  pathStr: string,
  acc: RollupAcc,
  win: { from: Date; to: Date },
): Record<string, unknown> {
  const windowHours = (win.to.getTime() - win.from.getTime()) / 3_600_000;
  const statusTotal = acc.online + acc.offline;
  const availability = statusTotal > 0 ? r2((acc.online / statusTotal) * 100) : null;
  const quality = acc.total > 0 ? r2((acc.good / acc.total) * 100) : null;
  const ngRate = acc.total > 0 ? r2((acc.reject / acc.total) * 100) : null;
  return {
    path: pathStr,
    ts: new Date().toISOString(),
    state: acc.total > 0 ? "EXECUTE" : "IDLE",
    values: {
      throughput_units: acc.total,
      throughput_per_hour: windowHours > 0 ? r2(acc.total / windowHours) : null,
      ng_rate_pct: ngRate,
      availability_pct: availability,
      quality_pct: quality,
      // Performance/OEE need per-machine ideal-cycle inputs not exposed at the
      // line grain — published as null (see partial/partial_reason).
      performance_pct: null,
      oee_pct: null,
      line_count: acc.lineCount,
      machine_count: acc.machineCount,
      good_count: acc.good,
      reject_count: acc.reject,
    },
    window: { from: win.from.toISOString(), to: win.to.toISOString() },
    metric_source: "rollup(oeeService.getLineOEE)",
    partial: true,
    partial_reason: "performance/oee not derivable at this grain (per-machine ideal-cycle inputs not exposed)",
  };
}

// ─── Core run (exported for tests / on-demand; NOT gated by the flag) ─────────

export async function runUnsAggregatesOnce(now: Date = new Date()): Promise<UnsAggregatesRunStats> {
  const t0 = Date.now();
  const to = now;
  const from = new Date(to.getTime() - windowMs());
  const stats: UnsAggregatesRunStats = {
    lines: 0,
    areas: 0,
    sites: 0,
    published: 0,
    skipped: 0,
    errors: 0,
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    ms: 0,
  };

  try {
    const db = await getDb();
    if (!db) {
      stats.ms = Date.now() - t0;
      return stats;
    }

    // 1) Real hierarchy map: line → workshop (area) → factory (site).
    const hierRows = executeRows(
      await db.execute(sql`
        SELECT l.id AS line_id, l.code AS line_code,
               w.id AS workshop_id, w.code AS workshop_code,
               f.id AS factory_id, f.code AS factory_code
        FROM production_lines l
        JOIN workshops w ON w.id = l."workshopId"
        JOIN factories f ON f.id = w."factoryId"
        WHERE l."isActive" = true
      `),
    ) as Array<{
      line_id: number;
      line_code: string;
      workshop_id: number;
      workshop_code: string;
      factory_id: number;
      factory_code: string;
    }>;
    const hierByLine = new Map<number, LineHierarchy>();
    for (const r of hierRows) {
      hierByLine.set(Number(r.line_id), {
        lineId: Number(r.line_id),
        lineCode: r.line_code,
        workshopId: Number(r.workshop_id),
        workshopCode: r.workshop_code,
        factoryId: Number(r.factory_id),
        factoryCode: r.factory_code,
      });
    }

    // 2) Canonical per-line metrics (semantic layer — ONE OEE definition).
    const lineMetrics = await getLineOEE({ from, to });

    // Rollup accumulators keyed by workshop / factory id.
    const areaAcc = new Map<number, { segs: { site: string; area: string }; acc: RollupAcc }>();
    const siteAcc = new Map<number, { site: string; acc: RollupAcc }>();

    // 3) Per-line publish — isolated so one line never blocks the others.
    for (const lm of lineMetrics) {
      stats.lines += 1;
      try {
        const hier = hierByLine.get(lm.lineId);
        if (!hier) {
          stats.skipped += 1;
          console.warn(
            `[UNS aggregates] line ${lm.lineId} (${lm.lineName}) has no active hierarchy row — skipped`,
          );
          continue;
        }
        const segs = {
          site: slugSegment(hier.factoryCode),
          area: slugSegment(hier.workshopCode),
          line: slugSegment(hier.lineCode),
        };
        const payload = buildLineNodePayload(lm, segs, { from, to });
        const ok = publishUnsV2(buildLineAggregateTopicV2(segs, "state"), payload, "state");
        if (ok) stats.published += 1;
        else stats.skipped += 1; // publisher not connected — honest skip, no buffering

        // Feed rollups regardless of publish outcome (compute once).
        let a = areaAcc.get(hier.workshopId);
        if (!a) {
          a = { segs: { site: segs.site, area: segs.area }, acc: emptyAcc() };
          areaAcc.set(hier.workshopId, a);
        }
        accumulate(a.acc, lm);

        let s = siteAcc.get(hier.factoryId);
        if (!s) {
          s = { site: segs.site, acc: emptyAcc() };
          siteAcc.set(hier.factoryId, s);
        }
        accumulate(s.acc, lm);
      } catch (err) {
        stats.errors += 1;
        console.error(
          `[UNS aggregates] line ${lm.lineId} aggregate failed:`,
          (err as Error)?.message || err,
        );
      }
    }

    // 4) Area (_area) rollups.
    for (const [workshopId, { segs, acc }] of areaAcc) {
      stats.areas += 1;
      try {
        const payload = buildRollupPayload(`${segs.site}/${segs.area}/_area`, acc, { from, to });
        const ok = publishUnsV2(buildAreaAggregateTopicV2(segs, "state"), payload, "state");
        if (ok) stats.published += 1;
        else stats.skipped += 1;
      } catch (err) {
        stats.errors += 1;
        console.error(
          `[UNS aggregates] area (workshop ${workshopId}) rollup failed:`,
          (err as Error)?.message || err,
        );
      }
    }

    // 5) Site (_site) rollups.
    for (const [factoryId, { site, acc }] of siteAcc) {
      stats.sites += 1;
      try {
        const payload = buildRollupPayload(`${site}/_site`, acc, { from, to });
        const ok = publishUnsV2(buildSiteAggregateTopicV2(site, "state"), payload, "state");
        if (ok) stats.published += 1;
        else stats.skipped += 1;
      } catch (err) {
        stats.errors += 1;
        console.error(
          `[UNS aggregates] site (factory ${factoryId}) rollup failed:`,
          (err as Error)?.message || err,
        );
      }
    }
  } catch (err) {
    // Top-level guard — a run must never throw into the scheduler.
    stats.errors += 1;
    console.error("[UNS aggregates] run error:", (err as Error)?.message || err);
  }

  stats.ms = Date.now() - t0;
  lastRunAt = new Date().toISOString();
  lastRunStats = stats;
  return stats;
}

// ─── Scheduler lifecycle (interval pattern — mirrors edgeStaleScheduler) ──────

/** Start the interval scheduler. No-op unless UNS_AGGREGATES_ENABLED === "true". */
export function startUnsAggregates(): void {
  if (!isUnsAggregatesEnabled()) {
    console.log("[UNS aggregates] disabled (set UNS_AGGREGATES_ENABLED=true to enable)");
    return;
  }
  if (timer) return;
  const interval = intervalMs();
  timer = setInterval(() => {
    if (running) return; // no overlap
    running = true;
    runUnsAggregatesOnce()
      .then((s) => {
        if (s.published > 0 || s.errors > 0) {
          console.log(
            `[UNS aggregates] ${s.windowFrom}→${s.windowTo}: lines=${s.lines} areas=${s.areas} sites=${s.sites} ` +
              `published=${s.published} skipped=${s.skipped} err=${s.errors} in ${s.ms}ms`,
          );
        }
      })
      .catch((err) => console.error("[UNS aggregates] tick failed:", (err as Error)?.message || err))
      .finally(() => {
        running = false;
      });
  }, interval);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[UNS aggregates] scheduler started (every ${interval}ms, window ${windowMs()}ms)`);
}

/** Stop the scheduler (shutdown). Safe when never started. */
export function stopUnsAggregates(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Status for dashboards / health. */
export function getUnsAggregatesStatus() {
  return {
    enabled: isUnsAggregatesEnabled(),
    intervalMs: intervalMs(),
    windowMs: windowMs(),
    running: !!timer,
    lastRunAt,
    lastRunStats,
  };
}
