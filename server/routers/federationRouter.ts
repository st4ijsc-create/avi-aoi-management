/**
 * Federation — Roll-up read API (key "federation"). Doc 13 / F1.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * READ-ONLY views over the core aggregator's roll-up store (site_kpi_rollup +
 * site_sync_log). This router NEVER writes to a site and NEVER triggers a poll —
 * it only surfaces what the aggregator has already landed, with HONEST staleness
 * so the F2 dashboard can badge each site OK / STALE / DOWN from real metadata
 * (now − fetchedAt) rather than pretending stale numbers are live.
 *
 * Procedures:
 *   • siteRollups      — latest snapshot per site (the dashboard grid) + status.
 *   • siteKpiHistory   — daily history rows for one site (trend).
 *   • syncLog          — recent poll attempts (per-site isolation forensics).
 *   • aggregateSummary — honest cross-site totals/averages (degrades to 1 site).
 *   • status           — aggregator scheduler heartbeat (honest health).
 *
 * RBAC: protectedProcedure (authenticated). The dashboard surface itself is
 * additionally gated by MOD_FEDERATION at the license layer in F2.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { sites, siteKpiRollup, siteSyncLog } from "../../drizzle/schema";

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return d;
}

/**
 * Derive an HONEST freshness badge from real metadata. No fetchedAt → "down"
 * (never synced). Age is compared against the site's own pollIntervalSec:
 *   OK    : age ≤ 2 × interval
 *   STALE : 2 × interval < age ≤ 6 × interval
 *   DOWN  : age > 6 × interval, OR site.status === 'error' (circuit/last fail)
 */
function freshness(
  fetchedAt: Date | null,
  pollIntervalSec: number,
  siteStatus: string,
  now = Date.now(),
): { state: "ok" | "stale" | "down"; ageSec: number | null } {
  if (!fetchedAt) return { state: "down", ageSec: null };
  const ageSec = Math.max(0, Math.round((now - fetchedAt.getTime()) / 1000));
  const interval = pollIntervalSec > 0 ? pollIntervalSec : 60;
  if (siteStatus === "error" || ageSec > interval * 6) return { state: "down", ageSec };
  if (ageSec > interval * 2) return { state: "stale", ageSec };
  return { state: "ok", ageSec };
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const federationRouter = router({
  /**
   * Latest snapshot per site (window='snapshot') joined with the site registry —
   * the source for the cross-site KPI grid. Sites with no snapshot yet are still
   * returned (state='down') so the grid is honest about what hasn't synced.
   */
  siteRollups: protectedProcedure
    .input(z.object({ corporateCode: z.string().max(50).optional() }).optional())
    .query(async ({ input }) => {
      const d = await db();
      const siteRows = await d.select().from(sites).orderBy(desc(sites.isLocal), sites.code);
      const filtered = input?.corporateCode
        ? siteRows.filter((s) => s.corporateCode === input.corporateCode)
        : siteRows;

      const snaps = await d
        .select()
        .from(siteKpiRollup)
        .where(and(eq(siteKpiRollup.window, "snapshot"), isNull(siteKpiRollup.bucketStart)));
      const bySite = new Map(snaps.map((r) => [r.siteId, r]));

      const now = Date.now();
      return filtered.map((s) => {
        const k = bySite.get(s.id);
        const f = freshness(k?.fetchedAt ?? null, s.pollIntervalSec, s.status, now);
        return {
          site: {
            id: s.id,
            code: s.code,
            name: s.name,
            corporateCode: s.corporateCode,
            region: s.region,
            isLocal: s.isLocal,
            status: s.status,
            lastSyncAt: s.lastSyncAt,
            lastError: s.lastError,
            consecutiveFailures: s.consecutiveFailures,
            pollIntervalSec: s.pollIntervalSec,
          },
          kpi: k
            ? {
                asOf: k.asOf,
                fetchedAt: k.fetchedAt,
                totalInspections: k.totalInspections,
                okCount: k.okCount,
                ngCount: k.ngCount,
                ntfCount: k.ntfCount,
                yieldRate: num(k.yieldRate),
                ngRate: num(k.ngRate),
                throughput: k.throughput,
                oee: num(k.oee),
                avgCycleTime: num(k.avgCycleTime),
                defectPareto: k.defectPareto ?? null,
                source: k.source,
              }
            : null,
          freshness: f, // { state, ageSec } — honest staleness for the badge
        };
      });
    }),

  /** Daily history (window='day') for one site — a trend without raw inspections. */
  siteKpiHistory: protectedProcedure
    .input(
      z.object({
        siteId: z.number().int().positive(),
        days: z.number().int().min(1).max(180).default(30),
      }),
    )
    .query(async ({ input }) => {
      const d = await db();
      const rows = await d
        .select()
        .from(siteKpiRollup)
        .where(and(eq(siteKpiRollup.siteId, input.siteId), eq(siteKpiRollup.window, "day")))
        .orderBy(desc(siteKpiRollup.bucketStart))
        .limit(input.days);
      return rows
        .map((r) => ({
          bucketStart: r.bucketStart,
          asOf: r.asOf,
          fetchedAt: r.fetchedAt,
          totalInspections: r.totalInspections,
          okCount: r.okCount,
          ngCount: r.ngCount,
          yieldRate: num(r.yieldRate),
          ngRate: num(r.ngRate),
          throughput: r.throughput,
          oee: num(r.oee),
        }))
        .reverse(); // chronological for charting
    }),

  /** Recent sync attempts (newest first) — per-site failure-isolation forensics. */
  syncLog: protectedProcedure
    .input(
      z.object({
        siteId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }).optional(),
    )
    .query(async ({ input }) => {
      const d = await db();
      const base = d.select().from(siteSyncLog).$dynamic();
      const q = input?.siteId ? base.where(eq(siteSyncLog.siteId, input.siteId)) : base;
      const rows = await q.orderBy(desc(siteSyncLog.startedAt)).limit(input?.limit ?? 50);
      return rows.map((r) => ({
        id: r.id,
        siteId: r.siteId,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        ok: r.ok,
        status: r.status,
        httpStatus: r.httpStatus,
        error: r.error,
        durationMs: r.durationMs,
        metricsFetched: r.metricsFetched,
        endpointsHit: r.endpointsHit ?? [],
      }));
    }),

  /**
   * Cross-site roll-up: totals (summed) + yield (units-weighted average). HONEST
   * with 1 site — `sitesReporting` and `sitesWithData` make the basis explicit,
   * and `crossSiteComparisonReady` is false until ≥2 sites report so the UI can
   * say "cross-site comparison needs ≥2 sites" instead of implying a ranking.
   */
  aggregateSummary: protectedProcedure
    .input(z.object({ corporateCode: z.string().max(50).optional() }).optional())
    .query(async ({ input }) => {
      const d = await db();
      const siteRows = await d.select().from(sites);
      const scopeSites = input?.corporateCode
        ? siteRows.filter((s) => s.corporateCode === input.corporateCode)
        : siteRows;
      const scopeIds = new Set(scopeSites.map((s) => s.id));

      const snaps = (
        await d
          .select()
          .from(siteKpiRollup)
          .where(and(eq(siteKpiRollup.window, "snapshot"), isNull(siteKpiRollup.bucketStart)))
      ).filter((r) => scopeIds.has(r.siteId));

      let totalInspections = 0;
      let okCount = 0;
      let ngCount = 0;
      let weightedYieldNum = 0;
      let weightedYieldDen = 0;
      let sitesWithData = 0;

      for (const r of snaps) {
        const ti = r.totalInspections ?? 0;
        if (ti > 0 || r.okCount != null || r.ngCount != null) sitesWithData++;
        totalInspections += ti;
        okCount += r.okCount ?? 0;
        ngCount += r.ngCount ?? 0;
        const y = num(r.yieldRate);
        if (y != null && ti > 0) {
          weightedYieldNum += y * ti;
          weightedYieldDen += ti;
        }
      }

      const overallYield =
        totalInspections > 0
          ? Number(((okCount / totalInspections) * 100).toFixed(2))
          : weightedYieldDen > 0
            ? Number((weightedYieldNum / weightedYieldDen).toFixed(2))
            : null;

      return {
        sitesTotal: scopeSites.length,
        sitesReporting: snaps.length,
        sitesWithData,
        totals: { totalInspections, okCount, ngCount },
        overallYieldRate: overallYield, // honest null when nothing has data
        overallNgRate:
          totalInspections > 0 ? Number(((ngCount / totalInspections) * 100).toFixed(2)) : null,
        // Cross-site comparison/ranking is only meaningful with ≥2 reporting sites.
        crossSiteComparisonReady: sitesWithData >= 2,
      };
    }),

  /** Aggregator scheduler heartbeat (honest health for an ops panel). */
  status: protectedProcedure.query(async () => {
    const { getFederationAggregatorStatus } = await import(
      "../services/federation/aggregatorService"
    );
    return getFederationAggregatorStatus();
  }),
});
