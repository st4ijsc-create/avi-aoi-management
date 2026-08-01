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

/**
 * Build the generalized per-category `metrics` bag carried on the "overall"
 * snapshot — a flat number|null map so a category a remote site can't provide is
 * honest-null, not a fabricated 0.
 */
function metricsBag(snap: SiteKpiSnapshot): Record<string, number | null> {
  return {
    tasksPending: snap.fleet?.tasksPending ?? null,
    tasksRunning: snap.fleet?.tasksRunning ?? null,
    robotsOnline: snap.fleet?.robotsOnline ?? null,
    robotsTotal: snap.fleet?.robotsTotal ?? null,
    safetyOpenEvents: snap.safety?.openEvents ?? null,
    safetyNearMisses: snap.safety?.nearMisses ?? null,
    safetyCritical: snap.safety?.critical ?? null,
    pdmOpenWos: snap.pdm?.openPredictiveWos ?? null,
    pdmHighRisk: snap.pdm?.highRiskMachines ?? null,
    alertsOpen: snap.alertRollup?.open ?? null,
    alertsCritical: snap.alertRollup?.critical ?? null,
  };
}

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
    // U5 — retained detail + alert roll-up + generalized metric bag live on the
    // "overall" snapshot row (the drill/alert source). Per-category rows below
    // carry only the columns relevant to that category (metrics bag repeated).
    //
    // IMPORTANT (no data-loss): the UNS stream (source='uns') carries ONLY inspection
    // KPIs — its snap has detailRows/alertRollup null. We must NOT let a UNS refresh
    // WIPE the richer detail a prior pull landed. So for the pull path we always write
    // these (fresh authoritative detail); for UNS we only write them when the snap
    // actually carries them (it won't) — otherwise we OMIT the key so the update leaves
    // the existing value intact (drizzle skips undefined on UPDATE; insert defaults NULL).
    ...(source === "poll" || snap.detailRows != null ? { detailRows: snap.detailRows ?? null } : {}),
    ...(source === "poll" || snap.alertRollup != null ? { alertRollup: snap.alertRollup ?? null } : {}),
    ...(source === "poll" || snap.fleet != null || snap.safety != null || snap.pdm != null
      ? { metrics: metricsBag(snap) }
      : {}),
    source,
    fetchedAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Upsert a single (site, category, window='snapshot') row — find-then-update/insert. */
async function upsertSnapshotRow(
  db: Db,
  siteId: number,
  category: string,
  values: InsertSiteKpiRollup,
): Promise<void> {
  const [existing] = await db
    .select({ id: siteKpiRollup.id })
    .from(siteKpiRollup)
    .where(
      and(
        eq(siteKpiRollup.siteId, siteId),
        eq(siteKpiRollup.category, category),
        eq(siteKpiRollup.window, "snapshot"),
        isNull(siteKpiRollup.bucketStart),
      ),
    )
    .limit(1);
  if (existing) {
    await db.update(siteKpiRollup).set(values).where(eq(siteKpiRollup.id, existing.id));
  } else {
    await db.insert(siteKpiRollup).values(values);
  }
}

/**
 * Upsert the latest snapshot rows for a site + append/replace a daily history row.
 *
 * U5 — the roll-up is now PER-CATEGORY. We write:
 *   • category='overall'  — the legacy full KPI row (carries detailRows/alertRollup/
 *     metrics) + a daily history row (window='day').
 *   • category='inspection' — the inspection KPIs (yield/NG/throughput).
 *   • category='oee'        — OEE only (honest null when the site has no OEE feed).
 *   • category='fleet'|'safety'|'pdm' — written ONLY when that feed answered, so a
 *     remote site that can't provide a category leaves NO row (honest absence) rather
 *     than a fabricated zero row.
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

  // 1) "overall" snapshot (full KPI + retained detail + alerts + metric bag).
  await upsertSnapshotRow(db, site.id, "overall", {
    ...cols,
    category: "overall",
    window: "snapshot",
    bucketStart: null,
  });
  written++;

  // 2) "inspection" snapshot — the pure inspection KPI slice.
  await upsertSnapshotRow(db, site.id, "inspection", {
    ...cols,
    category: "inspection",
    window: "snapshot",
    bucketStart: null,
    // inspection category doesn't need the detail/alert payload duplicated.
    detailRows: null,
    alertRollup: null,
  });
  written++;

  // 3) "oee" snapshot — OEE only (honest null when absent). Always written so the
  //    dashboard has a stable per-category row; the value itself is null-honest.
  await upsertSnapshotRow(db, site.id, "oee", {
    ...cols,
    category: "oee",
    window: "snapshot",
    bucketStart: null,
    detailRows: null,
    alertRollup: null,
  });
  written++;

  // 4) fleet/safety/pdm — write ONLY when that feed answered (honest absence).
  if (snap.fleet) {
    await upsertSnapshotRow(db, site.id, "fleet", { ...cols, category: "fleet", window: "snapshot", bucketStart: null, detailRows: null, alertRollup: null });
    written++;
  }
  if (snap.safety) {
    await upsertSnapshotRow(db, site.id, "safety", { ...cols, category: "safety", window: "snapshot", bucketStart: null, detailRows: null });
    written++;
  }
  if (snap.pdm) {
    await upsertSnapshotRow(db, site.id, "pdm", { ...cols, category: "pdm", window: "snapshot", bucketStart: null, detailRows: null, alertRollup: null });
    written++;
  }

  // 5) Daily history row (category='overall', window='day') — bucketStart non-null,
  //    so ON CONFLICT is safe. A small trend without storing raw inspections.
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
