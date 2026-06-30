/**
 * Federation roll-up store (doc 13 §4/§9) — persistence for the core aggregator.
 *
 * Lands pulled KPI snapshots into site_kpi_rollup and writes site_sync_log audit
 * rows. WRITE-ONLY to the CORE's own DB; it NEVER touches a site. Two row kinds:
 *   • window='snapshot' (bucketStart NULL) — the latest KPI per (site,category),
 *     upserted in place each cycle (the dashboard grid source).
 *   • window='day' (bucketStart = window start) — a small daily history row so a
 *     trend exists without storing raw inspections.
 *
 * The snapshot upsert is done as find-then-update/insert (not an ON CONFLICT on a
 * nullable column) so it is correct on any Postgres version. Honest staleness:
 * fetchedAt/asOf are always written from real fetch metadata, never back-dated.
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  siteKpiRollup,
  siteSyncLog,
  type Site,
  type InsertSiteKpiRollup,
} from "../../../drizzle/schema";
import type { SiteKpiSnapshot } from "./siteClient";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function kpiColumns(site: Site, snap: SiteKpiSnapshot, source: "poll" | "uns" = "poll") {
  return {
    siteId: site.id,
    corporateCode: site.corporateCode ?? null,
    asOf: snap.asOf,
    totalInspections: snap.totalInspections,
    okCount: snap.okCount,
    ngCount: snap.ngCount,
    ntfCount: snap.ntfCount,
    yieldRate: snap.yieldRate,
    ngRate: snap.ngRate,
    throughput: snap.throughput,
    oee: snap.oee,
    avgCycleTime: snap.avgCycleTime,
    defectPareto: snap.defectPareto ?? null,
    source,
    fetchedAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Upsert the latest snapshot row (window='snapshot', category='overall') for a
 * site and append/replace a daily history row (window='day').
 * Returns the number of roll-up rows written.
 */
export async function upsertSnapshot(
  db: Db,
  site: Site,
  snap: SiteKpiSnapshot,
  source: "poll" | "uns" = "poll",
): Promise<number> {
  let written = 0;
  const cols = kpiColumns(site, snap, source);

  // 1) Snapshot row — find-then-update/insert (bucketStart is NULL).
  const [existingSnap] = await db
    .select({ id: siteKpiRollup.id })
    .from(siteKpiRollup)
    .where(
      and(
        eq(siteKpiRollup.siteId, site.id),
        eq(siteKpiRollup.category, "overall"),
        eq(siteKpiRollup.window, "snapshot"),
        isNull(siteKpiRollup.bucketStart),
      ),
    )
    .limit(1);

  if (existingSnap) {
    await db.update(siteKpiRollup).set(cols).where(eq(siteKpiRollup.id, existingSnap.id));
  } else {
    await db.insert(siteKpiRollup).values({
      ...cols,
      category: "overall",
      window: "snapshot",
      bucketStart: null,
    } satisfies InsertSiteKpiRollup);
  }
  written++;

  // 2) Daily history row — bucketStart = UTC day start of asOf. ON CONFLICT is
  //    safe here because bucketStart is non-null.
  const dayStart = new Date(Date.UTC(
    snap.asOf.getUTCFullYear(),
    snap.asOf.getUTCMonth(),
    snap.asOf.getUTCDate(),
  ));
  await db
    .insert(siteKpiRollup)
    .values({
      ...cols,
      category: "overall",
      window: "day",
      bucketStart: dayStart,
    } satisfies InsertSiteKpiRollup)
    .onConflictDoUpdate({
      target: [
        siteKpiRollup.siteId,
        siteKpiRollup.category,
        siteKpiRollup.window,
        siteKpiRollup.bucketStart,
      ],
      set: cols,
    });
  written++;

  return written;
}

/** Write one site_sync_log audit row. Never throws into the cycle. */
export async function writeSyncLog(
  db: Db,
  row: {
    siteId: number;
    startedAt: Date;
    finishedAt: Date;
    ok: boolean;
    status: "ok" | "partial" | "failed" | "skipped";
    httpStatus?: number;
    error?: string;
    durationMs: number;
    metricsFetched: number;
    endpointsHit: string[];
  },
): Promise<void> {
  try {
    await db.insert(siteSyncLog).values({
      siteId: row.siteId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      ok: row.ok,
      status: row.status,
      httpStatus: row.httpStatus ?? null,
      error: row.error ?? null,
      durationMs: row.durationMs,
      metricsFetched: row.metricsFetched,
      endpointsHit: row.endpointsHit,
    });
  } catch (e) {
    console.error("[Federation] writeSyncLog failed:", (e as Error).message);
  }
}
