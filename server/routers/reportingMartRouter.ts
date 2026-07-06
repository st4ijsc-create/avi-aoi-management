/**
 * Reporting Mart Router (doc 35 B8 / doc 32 R1).
 * ============================================================================
 * Read-only tRPC surface over the dimensional mart (fact_inspection_hourly +
 * dim_shift/dim_product, drizzle/schema/reportingMart.ts). Lets BI / dashboards
 * query the pre-aggregated hourly fact instead of re-scanning the raw
 * product_inspections hypertable on every render.
 *
 * These COMPLEMENT — they do not replace — the on-the-fly reportAggregators
 * (server/db/reportAggregators.ts). They read only what the flag-gated refresh
 * job (server/services/reportingMartService.ts) has written; when the mart is
 * empty (refresh flag OFF / never run) they return empty results, and callers
 * that need always-fresh numbers keep using the live aggregators.
 *
 * WINDOW SEMANTICS: fact.bucketHour is FACTORY-LOCAL naive wall time (the same
 * bucketing utils/kpi uses). So this router filters in that same local space —
 * date-only inputs ("YYYY-MM-DD") are treated as factory-local calendar days
 * (end day inclusive, end-exclusive bound = day-after at local midnight). This
 * is deliberately NOT resolveFactoryDateWindow (which returns UTC instants for
 * the raw-inspectionTime space).
 *
 * RBAC: read-only, protectedProcedure (any authenticated user).
 */
import { z } from "zod";
import { and, eq, sql, SQL } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db/connection";
import { factInspectionHourly, dimShift, dimProduct } from "../../drizzle/schema/reportingMart";
import { finalYield, roundPct } from "../utils/kpi";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Factory-local naive bounds from date-only inputs: [start 00:00, dayAfterEnd
 * 00:00). Compared directly to the naive bucketHour column (bind as text →
 * Postgres casts to timestamp).
 */
function localDayBounds(startDate: string, endDate: string): { startStr: string; endStr: string } {
  const s = startDate.trim();
  const e = endDate.trim();
  const startStr = `${s} 00:00:00`;
  const [y, m, d] = e.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const endStr =
    `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(next.getUTCDate()).padStart(2, "0")} 00:00:00`;
  return { startStr, endStr };
}

const windowInput = z.object({
  startDate: z.string().regex(DATE_ONLY_RE, "expected YYYY-MM-DD"),
  endDate: z.string().regex(DATE_ONLY_RE, "expected YYYY-MM-DD"),
  factoryId: z.number().optional(),
  machineId: z.number().optional(),
  productModelId: z.number().optional(),
});
type WindowInput = z.infer<typeof windowInput>;

/** bucketHour window + optional dimension filters over the fact table. */
function factConditions(input: WindowInput): SQL[] {
  const { startStr, endStr } = localDayBounds(input.startDate, input.endDate);
  // bucketHour is naive factory-local; compare to text bounds (Postgres casts).
  const conds: SQL[] = [
    sql`${factInspectionHourly.bucketHour} >= ${startStr}`,
    sql`${factInspectionHourly.bucketHour} < ${endStr}`,
  ];
  if (input.factoryId != null) conds.push(eq(factInspectionHourly.factoryId, input.factoryId));
  if (input.machineId != null) conds.push(eq(factInspectionHourly.machineId, input.machineId));
  if (input.productModelId != null) conds.push(eq(factInspectionHourly.productModelId, input.productModelId));
  return conds;
}

const num = (v: unknown) => Number(v) || 0;

export const reportingMartRouter = router({
  /**
   * Output + canonical FINAL yield per shift over the window, read from the
   * mart. Shift names are resolved from dim_shift (preferring the global row).
   */
  yieldByShift: protectedProcedure.input(windowInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({
        shiftCode: factInspectionHourly.shiftCode,
        total: sql<number>`SUM(${factInspectionHourly.totalCount})`.as("total"),
        ok: sql<number>`SUM(${factInspectionHourly.okCount})`.as("ok"),
        ng: sql<number>`SUM(${factInspectionHourly.ngCount})`.as("ng"),
        ntf: sql<number>`SUM(${factInspectionHourly.ntfCount})`.as("ntf"),
      })
      .from(factInspectionHourly)
      .where(and(...factConditions(input)))
      .groupBy(factInspectionHourly.shiftCode);

    // Names from dim_shift (no join — avoid fan-out; prefer the global row).
    const shiftRows = await db
      .select({ shiftCode: dimShift.shiftCode, name: dimShift.name, factoryId: dimShift.factoryId })
      .from(dimShift);
    const nameByCode = new Map<string, string>();
    for (const s of shiftRows) {
      if (!nameByCode.has(s.shiftCode) || s.factoryId === 0) nameByCode.set(s.shiftCode, s.name);
    }

    return rows
      .map((r) => {
        const total = num(r.total), ok = num(r.ok), ng = num(r.ng), ntf = num(r.ntf);
        return {
          shiftCode: r.shiftCode,
          shiftName: nameByCode.get(r.shiftCode) ?? r.shiftCode,
          total, ok, ng, ntf,
          yieldPct: roundPct(finalYield({ ok, ntf, total }), 2),
        };
      })
      .sort((a, b) => a.shiftCode.localeCompare(b.shiftCode));
  }),

  /**
   * Hourly yield trend (one row per bucketHour) over the window, summed across
   * machines/products/shifts. Ordered chronologically. bucketHour is returned
   * as a factory-local 'YYYY-MM-DD HH24:00' string.
   */
  yieldTrendHourly: protectedProcedure.input(windowInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({
        bucket: sql<string>`TO_CHAR(${factInspectionHourly.bucketHour}, 'YYYY-MM-DD HH24:00')`.as("bucket"),
        total: sql<number>`SUM(${factInspectionHourly.totalCount})`.as("total"),
        ok: sql<number>`SUM(${factInspectionHourly.okCount})`.as("ok"),
        ng: sql<number>`SUM(${factInspectionHourly.ngCount})`.as("ng"),
        ntf: sql<number>`SUM(${factInspectionHourly.ntfCount})`.as("ntf"),
      })
      .from(factInspectionHourly)
      .where(and(...factConditions(input)))
      .groupBy(factInspectionHourly.bucketHour)
      .orderBy(factInspectionHourly.bucketHour);

    return rows.map((r) => {
      const total = num(r.total), ok = num(r.ok), ng = num(r.ng), ntf = num(r.ntf);
      return {
        hour: String(r.bucket),
        total, ok, ng, ntf,
        yieldPct: roundPct(finalYield({ ok, ntf, total }), 2),
      };
    });
  }),

  /**
   * Product mix — output + final yield per product model over the window, with
   * each product's share of total output. Product metadata from dim_product.
   * The productModelId=0 sentinel ("no product model") surfaces as an honest row.
   */
  productMix: protectedProcedure.input(windowInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({
        productModelId: factInspectionHourly.productModelId,
        total: sql<number>`SUM(${factInspectionHourly.totalCount})`.as("total"),
        ok: sql<number>`SUM(${factInspectionHourly.okCount})`.as("ok"),
        ng: sql<number>`SUM(${factInspectionHourly.ngCount})`.as("ng"),
        ntf: sql<number>`SUM(${factInspectionHourly.ntfCount})`.as("ntf"),
      })
      .from(factInspectionHourly)
      .where(and(...factConditions(input)))
      .groupBy(factInspectionHourly.productModelId);

    const prodRows = await db
      .select({
        productModelId: dimProduct.productModelId,
        code: dimProduct.code,
        name: dimProduct.name,
      })
      .from(dimProduct);
    const prodById = new Map(prodRows.map((p) => [p.productModelId, p]));

    const grandTotal = rows.reduce((s, r) => s + num(r.total), 0);
    return rows
      .map((r) => {
        const total = num(r.total), ok = num(r.ok), ng = num(r.ng), ntf = num(r.ntf);
        const p = prodById.get(r.productModelId);
        return {
          productModelId: r.productModelId,
          productCode: r.productModelId === 0 ? null : (p?.code ?? null),
          productName: r.productModelId === 0 ? "Chưa gán sản phẩm" : (p?.name ?? null),
          total, ok, ng, ntf,
          yieldPct: roundPct(finalYield({ ok, ntf, total }), 2),
          sharePct: grandTotal > 0 ? roundPct((total / grandTotal) * 100, 2) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }),
});
