/**
 * server/services/reportingMartService.ts — Reporting Mart refresh (doc 35 B8 /
 * doc 32 R1). FLAG-GATED, default OFF.
 * ============================================================================
 * Populates the dimensional mart (drizzle/schema/reportingMart.ts) from the raw
 * OLTP tables. TimescaleDB is NOT installed on the main DB, so there are no
 * continuous aggregates — this app job does the roll-up into PLAIN tables:
 *
 *   refreshDimensions()          — sync dim_shift (from shift_configs) and
 *                                  dim_product (from product_models). Idempotent
 *                                  upserts keyed by the dims' natural keys.
 *   refreshInspectionMart({from,to,factoryId?})
 *                                — aggregate product_inspections into hourly
 *                                  buckets and UPSERT fact_inspection_hourly.
 *   startReportingMartRefresh()  — periodic runner, gated by REPORTING_MART_ENABLED
 *                                  (default OFF), incremental (last N hours).
 *
 * SHIFT CONSISTENCY (the whole point of R1): the bucket's shiftCode is produced
 * by the SAME factory-local window classifier the rest of the app uses —
 * getApplicableShiftConfigs + buildShiftClassifierSql from server/db/shiftResolution.
 * Unscoped refresh uses the global/union shift set (matches getShiftStats with no
 * factory filter); a factory-scoped refresh uses that factory's own shift windows
 * (matches getShiftReport({factoryId})). Hour/shift buckets are computed in the
 * FACTORY timezone via utils/kpi.factoryDateTruncSql, so bucketHour is factory-
 * local naive wall time — the same space the mart router filters in.
 *
 * IDEMPOTENCY: the fact grain (bucketHour, machineId, productModelId, shiftCode)
 * is a UNIQUE index; the refresh is INSERT … ON CONFLICT DO UPDATE, so re-running
 * over an overlapping window fully recomputes each bucket (no double-count). The
 * nullable source columns are COALESCEd to sentinels (productModelId→0) so no
 * grain-key column is ever NULL (Postgres treats NULLs in a unique index as
 * distinct, which would defeat the upsert).
 *
 * Best-effort: every entry point is try/caught and NEVER throws to its caller
 * (a broken mart must not take down ingest or boot).
 */
import { getDb } from "../db/connection";
import { sql, eq } from "drizzle-orm";
import {
  productInspections,
  factories,
  shiftConfigs,
  productModels,
} from "../../drizzle/schema";
import { dimShift, dimProduct } from "../../drizzle/schema/reportingMart";
import { factoryDateTruncSql } from "../utils/kpi";
import { getApplicableShiftConfigs, buildShiftClassifierSql } from "../db/shiftResolution";

// ═══════════════════════════════════════════════════════════════════════════
// Flag + tunables
// ═══════════════════════════════════════════════════════════════════════════

/** Refresh job runs ONLY when REPORTING_MART_ENABLED === "true" (default OFF). */
export function reportingMartEnabled(): boolean {
  return process.env.REPORTING_MART_ENABLED === "true";
}

/** Refresh cadence (ms). Default hourly. */
function refreshIntervalMs(): number {
  const m = Number(process.env.REPORTING_MART_INTERVAL_MS);
  return Number.isFinite(m) && m > 0 ? m : 60 * 60 * 1000;
}

/** Incremental look-back window (hours) reprocessed each tick. Default 3. */
function windowHours(): number {
  const h = Number(process.env.REPORTING_MART_WINDOW_HOURS);
  return Number.isFinite(h) && h > 0 ? h : 3;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dimension sync
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sync dim_shift (from shift_configs) and dim_product (from product_models).
 * Idempotent upserts on each dim's natural key. factoryId is COALESCEd to 0
 * ("global shift") so the (shiftCode, factoryId) unique key is never NULL.
 * Never throws.
 */
export async function refreshDimensions(): Promise<{ shifts: number; products: number }> {
  try {
    const db = await getDb();
    if (!db) return { shifts: 0, products: 0 };

    const shifts = await db.select().from(shiftConfigs);
    for (const s of shifts) {
      await db
        .insert(dimShift)
        .values({
          shiftCode: s.code,
          name: s.name,
          startHour: s.startHour,
          startMinute: s.startMinute,
          endHour: s.endHour,
          endMinute: s.endMinute,
          factoryId: s.factoryId ?? 0,
        })
        .onConflictDoUpdate({
          target: [dimShift.shiftCode, dimShift.factoryId],
          set: {
            name: s.name,
            startHour: s.startHour,
            startMinute: s.startMinute,
            endHour: s.endHour,
            endMinute: s.endMinute,
            updatedAt: new Date(),
          },
        });
    }

    const products = await db
      .select({
        id: productModels.id,
        code: productModels.code,
        name: productModels.name,
        category: productModels.category,
        revision: productModels.revision,
      })
      .from(productModels);
    for (const p of products) {
      await db
        .insert(dimProduct)
        .values({
          productModelId: p.id,
          code: p.code,
          name: p.name,
          category: p.category ?? null,
          revision: p.revision ?? null,
        })
        .onConflictDoUpdate({
          target: [dimProduct.productModelId],
          set: {
            code: p.code,
            name: p.name,
            category: p.category ?? null,
            revision: p.revision ?? null,
            updatedAt: new Date(),
          },
        });
    }

    return { shifts: shifts.length, products: products.length };
  } catch (err) {
    console.error("[ReportingMart] refreshDimensions failed:", (err as any)?.message || err);
    return { shifts: 0, products: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Fact refresh
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate product_inspections in [from, to) into hourly buckets and UPSERT
 * fact_inspection_hourly. `from`/`to` are instants in the stored-inspectionTime
 * space (same as every other aggregate — see utils/kpi storage semantics).
 * `factoryId` (optional) scopes BOTH the data (by factoryCode) AND the shift
 * classifier windows, exactly like getShiftReport({factoryId}).
 *
 * Single statement, two CTEs:
 *  - agg: counts per grain, factory_id via MAX (one representative per grain so
 *    the INSERT never hits the same ON CONFLICT row twice).
 *  - fpy: true First-Pass-Yield inputs — first inspection per serial in the
 *    window (DISTINCT ON serial), bucketed by that first inspection's grain.
 * Never throws.
 */
export async function refreshInspectionMart(opts: {
  from: Date | string;
  to: Date | string;
  factoryId?: number;
}): Promise<{ ok: boolean; affected: number }> {
  try {
    const db = await getDb();
    if (!db) return { ok: false, affected: 0 };

    const fromIso = typeof opts.from === "string" ? opts.from : opts.from.toISOString();
    const toIso = typeof opts.to === "string" ? opts.to : opts.to.toISOString();

    // Optional factory scope: resolve the factoryCode product_inspections stores.
    let factoryCode: string | undefined;
    if (opts.factoryId != null) {
      const [f] = await db
        .select({ code: factories.code })
        .from(factories)
        .where(eq(factories.id, opts.factoryId))
        .limit(1);
      // Unknown factory → scope to an impossible code so we roll up nothing
      // (rather than silently ignoring the scope and rolling up everything).
      factoryCode = f?.code ?? "\x00__no_such_factory__";
    }

    // Shift classifier: SAME source as getShiftStats/getShiftReport. Unscoped →
    // global/union set; scoped → that factory's windows.
    const metas = await getApplicableShiftConfigs(db, opts.factoryId);
    const tsCol = productInspections.inspectionTime;
    const bucketExpr = factoryDateTruncSql("hour", tsCol);
    const { expr: shiftExpr } = buildShiftClassifierSql(metas, tsCol);
    const productExpr = sql`COALESCE(${productInspections.productModelId}, 0)`;

    // Window (+ optional factory scope) predicate — used by BOTH CTEs.
    const scope = [
      sql`${productInspections.inspectionTime} >= ${fromIso}`,
      sql`${productInspections.inspectionTime} < ${toIso}`,
    ];
    if (factoryCode !== undefined) scope.push(sql`${productInspections.factoryCode} = ${factoryCode}`);
    const whereSql = sql.join(scope, sql` AND `);

    const result = await db.execute(sql`
      WITH agg AS (
        SELECT
          ${bucketExpr} AS bucket_hour,
          ${productInspections.machineId} AS machine_id,
          ${productExpr} AS product_model_id,
          ${shiftExpr} AS shift_code,
          MAX(${factories.id}) AS factory_id,
          COUNT(*)::int AS total,
          SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)::int AS ok,
          SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)::int AS ng,
          SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)::int AS ntf
        FROM ${productInspections}
        LEFT JOIN ${factories} ON ${factories.code} = ${productInspections.factoryCode}
        WHERE ${whereSql}
        GROUP BY ${bucketExpr}, ${productInspections.machineId}, ${productExpr}, ${shiftExpr}
      ),
      fpy AS (
        SELECT bucket_hour, machine_id, product_model_id, shift_code,
          COUNT(*)::int AS first_total,
          COUNT(*) FILTER (WHERE result = 'OK')::int AS first_pass
        FROM (
          SELECT DISTINCT ON (${productInspections.serialNumber})
            ${bucketExpr} AS bucket_hour,
            ${productInspections.machineId} AS machine_id,
            ${productExpr} AS product_model_id,
            ${shiftExpr} AS shift_code,
            ${productInspections.overallResult} AS result
          FROM ${productInspections}
          WHERE ${whereSql} AND ${productInspections.serialNumber} <> ''
          ORDER BY ${productInspections.serialNumber}, ${productInspections.inspectionTime} ASC, ${productInspections.id} ASC
        ) firsts
        GROUP BY bucket_hour, machine_id, product_model_id, shift_code
      )
      INSERT INTO fact_inspection_hourly
        ("bucketHour", "factoryId", "machineId", "productModelId", "shiftCode",
         "totalCount", "okCount", "ngCount", "ntfCount", "yieldPct", "fpyPct", "computedAt")
      SELECT
        agg.bucket_hour, agg.factory_id, agg.machine_id, agg.product_model_id, agg.shift_code,
        agg.total, agg.ok, agg.ng, agg.ntf,
        ROUND((agg.ok + agg.ntf) * 100.0 / NULLIF(agg.total, 0), 2),
        CASE WHEN fpy.first_total > 0
             THEN ROUND(fpy.first_pass * 100.0 / fpy.first_total, 2)
             ELSE NULL END,
        now()
      FROM agg
      LEFT JOIN fpy
        ON  fpy.bucket_hour = agg.bucket_hour
        AND fpy.machine_id = agg.machine_id
        AND fpy.product_model_id = agg.product_model_id
        AND fpy.shift_code = agg.shift_code
      ON CONFLICT ("bucketHour", "machineId", "productModelId", "shiftCode")
      DO UPDATE SET
        "factoryId"  = EXCLUDED."factoryId",
        "totalCount" = EXCLUDED."totalCount",
        "okCount"    = EXCLUDED."okCount",
        "ngCount"    = EXCLUDED."ngCount",
        "ntfCount"   = EXCLUDED."ntfCount",
        "yieldPct"   = EXCLUDED."yieldPct",
        "fpyPct"     = EXCLUDED."fpyPct",
        "computedAt" = EXCLUDED."computedAt"
    `);

    const affected = Number((result as any)?.count ?? (result as any)?.rowCount ?? 0) || 0;
    return { ok: true, affected };
  } catch (err) {
    console.error("[ReportingMart] refreshInspectionMart failed:", (err as any)?.message || err);
    return { ok: false, affected: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Periodic runner (FLAG-OFF by default; registered by _core/backgroundJobs.ts)
// ═══════════════════════════════════════════════════════════════════════════

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Floor a Date to the top of its hour (UTC) so incremental buckets stay whole. */
function floorHour(d: Date): Date {
  const f = new Date(d);
  f.setUTCMinutes(0, 0, 0);
  return f;
}

/** One incremental pass: dims + the last N hours of the fact. Never throws. */
async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await refreshDimensions();
    const to = new Date();
    const from = floorHour(new Date(to.getTime() - windowHours() * 60 * 60 * 1000));
    await refreshInspectionMart({ from, to });
  } finally {
    running = false;
  }
}

/**
 * Start the periodic mart refresh. NO-OP unless REPORTING_MART_ENABLED === "true".
 * Registered in _core/backgroundJobs.ts (see wiring notes) — safe to call once.
 */
export function startReportingMartRefresh(): void {
  if (!reportingMartEnabled()) {
    console.log("[ReportingMart] refresh disabled (REPORTING_MART_ENABLED != 'true')");
    return;
  }
  if (timer) return;
  const intervalMs = refreshIntervalMs();
  console.log(
    `[ReportingMart] refresh enabled — every ${intervalMs}ms, window ${windowHours()}h`,
  );
  // Kick off shortly after boot, then on the interval.
  setTimeout(() => { runOnce().catch(() => {}); }, 10_000).unref?.();
  timer = setInterval(() => { runOnce().catch(() => {}); }, intervalMs);
  timer.unref?.();
}

/** Stop the runner (tests / graceful shutdown). */
export function stopReportingMartRefresh(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
