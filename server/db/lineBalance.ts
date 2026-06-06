// Sprint F6 — read-only DB access for line-balance / bottleneck AI tools.
//
// Additive module (no existing lineBalance helper existed; the wipRouter had
// inline queries only). All functions are READ-ONLY and Number()-normalize the
// decimal percentage columns. Used by handlersF6 (get_line_balance) and
// insightHandlersF6 (analyze_line_bottleneck). No writes.
import { getDb } from "./connection";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { lineBalanceMetrics, stationDwellTime, productionLines } from "../../drizzle/schema";

export interface LineBalanceRow {
  id: number;
  lineId: number;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  taktTimeMs: number | null;
  avgCycleTimeMs: number | null;
  maxCycleTimeMs: number | null;
  bottleneckStationId: number | null;
  bottleneckMachineId: number | null;
  utilizationPct: number | null;
  balanceRatePct: number | null;
  throughputUnits: number;
  wipCount: number;
}

function mapRow(r: typeof lineBalanceMetrics.$inferSelect): LineBalanceRow {
  return {
    id: r.id,
    lineId: r.lineId,
    periodStart: r.periodStart ? new Date(r.periodStart).toISOString() : "",
    periodEnd: r.periodEnd ? new Date(r.periodEnd).toISOString() : "",
    taktTimeMs: r.taktTimeMs ?? null,
    avgCycleTimeMs: r.avgCycleTimeMs ?? null,
    maxCycleTimeMs: r.maxCycleTimeMs ?? null,
    bottleneckStationId: r.bottleneckStationId ?? null,
    bottleneckMachineId: r.bottleneckMachineId ?? null,
    utilizationPct: r.utilizationPct == null ? null : Number(r.utilizationPct),
    balanceRatePct: r.balanceRatePct == null ? null : Number(r.balanceRatePct),
    throughputUnits: Number(r.throughputUnits ?? 0),
    wipCount: Number(r.wipCount ?? 0),
  };
}

/** Resolve a line code (e.g. "L-A") to its id. Returns null when not found. */
export async function resolveLineIdByCode(lineCode: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: productionLines.id })
    .from(productionLines)
    .where(eq(productionLines.code, lineCode))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Most-recent line-balance metric row for a line, or null. */
export async function getLatestLineBalance(lineId: number): Promise<LineBalanceRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(lineBalanceMetrics)
    .where(eq(lineBalanceMetrics.lineId, lineId))
    .orderBy(desc(lineBalanceMetrics.periodStart))
    .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Line-balance metric rows for a line since `since`, oldest first. */
export async function getLineBalanceSeries(lineId: number, since: Date): Promise<LineBalanceRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(lineBalanceMetrics)
    .where(and(eq(lineBalanceMetrics.lineId, lineId), gte(lineBalanceMetrics.periodStart, since)))
    .orderBy(asc(lineBalanceMetrics.periodStart));
  return rows.map(mapRow);
}

export interface StationDwellAgg {
  stationId: number;
  avgDwellMs: number;
  avgStarvedMs: number;
  avgBlockedMs: number;
  samples: number;
}

/**
 * Per-station dwell aggregation for a line since `since`, ordered by dwell desc
 * (worst station first). Used to surface top starved / blocked stations.
 */
export async function getStationDwellAgg(lineId: number, since: Date): Promise<StationDwellAgg[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      stationId: stationDwellTime.stationId,
      avgDwellMs: sql<number>`coalesce(avg(${stationDwellTime.dwellMs}),0)::int`,
      avgStarvedMs: sql<number>`coalesce(avg(${stationDwellTime.starvedMs}),0)::int`,
      avgBlockedMs: sql<number>`coalesce(avg(${stationDwellTime.blockedMs}),0)::int`,
      samples: sql<number>`count(*)::int`,
    })
    .from(stationDwellTime)
    .where(and(eq(stationDwellTime.lineId, lineId), gte(stationDwellTime.enteredAt, since)))
    .groupBy(stationDwellTime.stationId)
    .orderBy(desc(sql`coalesce(avg(${stationDwellTime.dwellMs}),0)`));
  return rows.map((r) => ({
    stationId: Number(r.stationId),
    avgDwellMs: Number(r.avgDwellMs ?? 0),
    avgStarvedMs: Number(r.avgStarvedMs ?? 0),
    avgBlockedMs: Number(r.avgBlockedMs ?? 0),
    samples: Number(r.samples ?? 0),
  }));
}
