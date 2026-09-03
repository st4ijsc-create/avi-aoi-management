import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { getDb } from "../db/connection";
import { eq, and, desc, gte, lte, sql, inArray, SQL } from "drizzle-orm";
import {
  stations,
  machines,
  productionLines,
  workshops,
  factories,
  productInspections,
  measurementResults,
  measurementPointDefs,
  productModels,
} from "../../drizzle/schema";
import { statsCache, CACHE_KEYS, CACHE_TTL } from "../_core/cache";
import { resolveFactoryDateWindow, finalYield as finalYieldPct } from "../utils/kpi";
import { getFalseCallEscapeKpi } from "../services/falseCallEscapeService";

export const productionDashboardRouter = router({
  /**
   * Doc 27 gap A9 (W5-A) — paired false-call ↔ escape KPI (the AOI tuning
   * trade-off). falseCallRate = NTF / machine-NG-calls (honest rename of the
   * old NTF/total `retestRate` proxy); escapeRate comes from station_traces
   * (stationTriangulation). Definitions, scope caveats and the visual-only
   * threshold wiring are documented in services/falseCallEscapeService.ts.
   * Date-only strings are resolved as FACTORY-local calendar days.
   */
  getFalseCallEscape: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      machineId: z.number().optional(),
      lineId: z.number().optional(),
      factoryId: z.number().optional(),
      productModelId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const window = resolveFactoryDateWindow(input.startDate, input.endDate);

      // Resolve machine scope from hierarchy filters (single machine wins).
      let machineIds: number[] | undefined;
      if (input.machineId) {
        machineIds = [input.machineId];
      } else if (input.lineId || input.factoryId) {
        const database = await getDb();
        machineIds = database
          ? await resolveMachineIds(database, { factoryId: input.factoryId, lineId: input.lineId })
          : [];
      }

      return getFalseCallEscapeKpi({
        startDate: window.start,
        endDate: window.end,
        machineIds,
        productModelId: input.productModelId,
      });
    }),

  /**
   * Get per-station production overview.
   * Each row = 1 station with yield, output, retests, top defects.
   */
  getStationOverview: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input, ctx }) => {
      type StationOverviewRow = {
        station: typeof stations.$inferSelect;
        line: typeof productionLines.$inferSelect;
        workshop: typeof workshops.$inferSelect;
        factory: typeof factories.$inferSelect;
        machineCount: number;
        totalInspections: number;
        okCount: number;
        ngCount: number;
        ntfCount: number;
        firstPassYield: number;
        finalYield: number;
        retestRate: number;
        output: number;
        yieldChange: number;
        topDefects: { pointDefId: number; code: string; name: string; ngCount: number; percentage: number }[];
        measurementPointCount: number;
      };

      const cacheKey = statsCache.generateKey("PRODUCTION_DASHBOARD", input);
      const cached = statsCache.get<StationOverviewRow[]>(cacheKey);
      if (cached) return cached;

      const database = await getDb();
      if (!database) return [] as StationOverviewRow[];

      // Build station filter conditions
      const stationConditions: SQL[] = [eq(stations.isActive, true)];
      if (input.lineId) {
        stationConditions.push(eq(stations.lineId, input.lineId));
      }

      // If factory/workshop filter, resolve line IDs first
      if (input.factoryId || input.workshopId) {
        let lineIds: number[] = [];
        if (input.workshopId) {
          const lines = await database.select({ id: productionLines.id })
            .from(productionLines)
            .where(eq(productionLines.workshopId, input.workshopId));
          lineIds = lines.map(l => l.id);
        } else if (input.factoryId) {
          const ws = await database.select({ id: workshops.id })
            .from(workshops)
            .where(eq(workshops.factoryId, input.factoryId));
          if (ws.length > 0) {
            const lines = await database.select({ id: productionLines.id })
              .from(productionLines)
              .where(inArray(productionLines.workshopId, ws.map(w => w.id)));
            lineIds = lines.map(l => l.id);
          }
        }
        if (lineIds.length > 0) {
          stationConditions.push(inArray(stations.lineId, lineIds));
        } else {
          return [] as StationOverviewRow[];
        }
      }

      // Fetch all stations with hierarchy info
      const stationRows = await database.select({
        station: stations,
        line: productionLines,
        workshop: workshops,
        factory: factories,
      })
        .from(stations)
        .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
        .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
        .innerJoin(factories, eq(workshops.factoryId, factories.id))
        .where(and(...stationConditions))
        .orderBy(factories.name, workshops.name, productionLines.name, stations.orderIndex);

      // For each station, compute stats
      const result = await Promise.all(stationRows.map(async (row) => {
        // Get machines for this station
        const stationMachines = await database.select({ id: machines.id, name: machines.name, code: machines.code })
          .from(machines)
          .where(and(eq(machines.stationId, row.station.id), eq(machines.isActive, true)));
        
        const machineIds = stationMachines.map(m => m.id);
        if (machineIds.length === 0) {
          return {
            station: row.station,
            line: row.line,
            workshop: row.workshop,
            factory: row.factory,
            machineCount: 0,
            totalInspections: 0,
            okCount: 0,
            ngCount: 0,
            ntfCount: 0,
            firstPassYield: 0,
            finalYield: 0,
            retestRate: 0,
            output: 0,
            yieldChange: 0,
            topDefects: [],
            measurementPointCount: 0,
          };
        }

        // Build inspection conditions
        const inspConditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
        if (input.startDate) inspConditions.push(gte(productInspections.inspectionTime, input.startDate));
        if (input.endDate) inspConditions.push(lte(productInspections.inspectionTime, input.endDate));

        // Build previous period conditions
        let prevQueryPromise: Promise<{ total: number; ok: number }[]> | null = null;
        if (input.startDate && input.endDate) {
          const duration = input.endDate.getTime() - input.startDate.getTime();
          const prevEnd = new Date(input.startDate.getTime() - 1);
          const prevStart = new Date(prevEnd.getTime() - duration);
          const prevConditions: SQL[] = [
            inArray(productInspections.machineId, machineIds),
            gte(productInspections.inspectionTime, prevStart),
            lte(productInspections.inspectionTime, prevEnd),
          ];
          prevQueryPromise = database.select({
            total: sql<number>`count(*)`,
            ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
          }).from(productInspections).where(and(...prevConditions));
        }

        // Run all independent queries in parallel
        const [statsResult, topDefects, mpCount, latestInsp, prevResult] = await Promise.all([
          // Aggregate stats
          database.select({
            total: sql<number>`count(*)`,
            ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
            ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
            ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
          }).from(productInspections).where(and(...inspConditions)),
          // Top 3 defects
          getTopDefectsForMachines(database, machineIds, input.startDate, input.endDate, 3),
          // Measurement point count
          database.select({
            count: sql<number>`count(distinct ${measurementPointDefs.id})`,
          })
            .from(measurementResults)
            .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
            .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
            .where(and(inArray(productInspections.machineId, machineIds))),
          // Latest product image
          database.select({
            productModelId: productInspections.productModelId,
          })
            .from(productInspections)
            .where(and(
              inArray(productInspections.machineId, machineIds),
              sql`${productInspections.productModelId} IS NOT NULL`,
            ))
            .orderBy(desc(productInspections.inspectionTime))
            .limit(1),
          // Previous period (null if no date range)
          prevQueryPromise ?? Promise.resolve(null),
        ]);

        const stats = statsResult[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
        const total = Number(stats.total) || 0;
        const ok = Number(stats.ok) || 0;
        const ng = Number(stats.ng) || 0;
        const ntf = Number(stats.ntf) || 0;
        const firstPassYield = total > 0 ? Math.round((ok / total) * 10000) / 100 : 0;
        const finalYield = Math.round(finalYieldPct({ ok, ntf, total }) * 100) / 100;
        const retestRate = total > 0 ? Math.round((ntf / total) * 10000) / 100 : 0;

        // Compute yield change from previous period
        let yieldChange = 0;
        if (prevResult) {
          const prevTotal = Number(prevResult[0]?.total) || 0;
          const prevOk = Number(prevResult[0]?.ok) || 0;
          const prevFPY = prevTotal > 0 ? (prevOk / prevTotal) * 100 : 0;
          yieldChange = Math.round((firstPassYield - prevFPY) * 100) / 100;
        }

        // Get product image from latest inspection
        let latestProductImage: string | null = null;
        if (latestInsp.length > 0 && latestInsp[0].productModelId) {
          const pm = await database.select({ referenceImageUrl: productModels.referenceImageUrl })
            .from(productModels)
            .where(eq(productModels.id, latestInsp[0].productModelId))
            .limit(1);
          latestProductImage = pm[0]?.referenceImageUrl || null;
        }

        return {
          station: row.station,
          line: row.line,
          workshop: row.workshop,
          factory: row.factory,
          machineCount: stationMachines.length,
          totalInspections: total,
          okCount: ok,
          ngCount: ng,
          ntfCount: ntf,
          firstPassYield,
          finalYield,
          retestRate,
          output: total,
          yieldChange,
          topDefects,
          measurementPointCount: Number(mpCount[0]?.count) || 0,
          latestProductImage,
        };
      }));

      statsCache.set(cacheKey, result, CACHE_TTL.SHORT);
      return result;
    }),

  /**
   * Defect distribution for the Defect Analysis tab.
   * Returns: per defect-type aggregation (count, %, stations affected) + by-station breakdown.
   */
  getDefectAnalysis: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      lineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { defectsByType: [], defectsByStation: [] };

      // Resolve machine IDs from filters
      const machineIds = await resolveMachineIds(database, input);
      if (machineIds.length === 0) return { defectsByType: [], defectsByStation: [] };

      const conditions: SQL[] = [
        eq(measurementResults.result, 'NG'),
        inArray(productInspections.machineId, machineIds),
      ];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      // Defects by type (Pareto)
      const byType = await database.select({
        pointDefId: measurementResults.pointDefId,
        ngCount: sql<number>`count(*)`.as('ng_count'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conditions))
        .groupBy(measurementResults.pointDefId)
        .orderBy(desc(sql`ng_count`))
        .limit(15);

      const totalNG = byType.reduce((s, r) => s + Number(r.ngCount), 0) || 1;

      // Get point def names
      const pointDefIds = byType.map(r => r.pointDefId);
      const pointDefs = pointDefIds.length > 0
        ? await database.select().from(measurementPointDefs).where(inArray(measurementPointDefs.id, pointDefIds))
        : [];
      const defMap = new Map(pointDefs.map(p => [p.id, p]));

      let cumPct = 0;
      const defectsByType = byType.map(r => {
        const def = defMap.get(r.pointDefId);
        const pct = Math.round((Number(r.ngCount) / totalNG) * 10000) / 100;
        cumPct += pct;
        return {
          pointDefId: r.pointDefId,
          code: def?.code || 'Unknown',
          name: def?.name || 'Unknown',
          ngCount: Number(r.ngCount),
          percentage: pct,
          cumPercentage: Math.round(cumPct * 100) / 100,
        };
      });

      // Defects by station
      const byStation = await database.select({
        stationId: stations.id,
        stationName: stations.name,
        stationCode: stations.code,
        ngCount: sql<number>`count(*)`.as('ng_count'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .innerJoin(machines, eq(productInspections.machineId, machines.id))
        .innerJoin(stations, eq(machines.stationId, stations.id))
        .where(and(...conditions))
        .groupBy(stations.id, stations.name, stations.code)
        .orderBy(desc(sql`ng_count`))
        .limit(20);

      const defectsByStation = byStation.map(r => ({
        stationId: Number(r.stationId),
        stationName: r.stationName,
        stationCode: r.stationCode,
        ngCount: Number(r.ngCount),
        percentage: Math.round((Number(r.ngCount) / totalNG) * 10000) / 100,
      }));

      return { defectsByType, defectsByStation };
    }),

  /**
   * Yield & output trend over time for the Trend tab.
   */
  getTrendData: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      lineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      interval: z.enum(["hour", "day", "week"]).default("day"),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];

      const machineIds = await resolveMachineIds(database, input);
      if (machineIds.length === 0) return [];

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      // date_trunc expression
      const truncExpr =
        input.interval === "hour"
          ? sql`date_trunc('hour', ${productInspections.inspectionTime})`
          : input.interval === "week"
            ? sql`date_trunc('week', ${productInspections.inspectionTime})`
            : sql`date_trunc('day', ${productInspections.inspectionTime})`;

      const rows = await database.select({
        period: truncExpr.as('period'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
        ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...conditions))
        .groupBy(sql`period`)
        .orderBy(sql`period`);

      return rows.map(r => {
        const total = Number(r.total) || 0;
        const ok = Number(r.ok) || 0;
        const ng = Number(r.ng) || 0;
        const ntf = Number(r.ntf) || 0;
        return {
          period: String(r.period),
          total,
          ok,
          ng,
          ntf,
          fpy: total > 0 ? Math.round((ok / total) * 10000) / 100 : 0,
          finalYield: Math.round(finalYieldPct({ ok, ntf, total }) * 100) / 100,
        };
      });
    }),

  /**
   * SPC summary data for the SPC tab.
   * Returns: per-station Cpk estimate, mean yield, stddev, control limits.
   */
  getSpcSummary: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      lineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];

      const machineIds = await resolveMachineIds(database, input);
      if (machineIds.length === 0) return [];

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      // Group by station → compute yield stats
      const rows = await database.select({
        stationId: stations.id,
        stationName: stations.name,
        stationCode: stations.code,
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .innerJoin(machines, eq(productInspections.machineId, machines.id))
        .innerJoin(stations, eq(machines.stationId, stations.id))
        .where(and(...conditions))
        .groupBy(stations.id, stations.name, stations.code)
        .orderBy(stations.name);

      // For each station, compute daily yields to get stddev
      const results = await Promise.all(rows.map(async (row) => {
        const total = Number(row.total) || 0;
        const ok = Number(row.ok) || 0;
        const fpy = total > 0 ? (ok / total) * 100 : 0;

        // Get daily yields for this station
        const stationMachines = await database.select({ id: machines.id })
          .from(machines)
          .where(eq(machines.stationId, row.stationId));
        const smIds = stationMachines.map(m => m.id);
        if (smIds.length === 0) return null;

        const dailyConditions: SQL[] = [inArray(productInspections.machineId, smIds)];
        if (input.startDate) dailyConditions.push(gte(productInspections.inspectionTime, input.startDate));
        if (input.endDate) dailyConditions.push(lte(productInspections.inspectionTime, input.endDate));

        const dailyRows = await database.select({
          day: sql`date_trunc('day', ${productInspections.inspectionTime})`.as('day'),
          total: sql<number>`count(*)`,
          ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
          ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
        })
          .from(productInspections)
          .where(and(...dailyConditions))
          .groupBy(sql`day`)
          .orderBy(sql`day`);

        const yields = dailyRows.map(d => {
          const t = Number(d.total) || 0;
          const o = Number(d.ok) || 0;
          const n = Number(d.ntf) || 0;
          return finalYieldPct({ ok: o, ntf: n, total: t });
        });

        const mean = yields.length > 0 ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
        const variance = yields.length > 1
          ? yields.reduce((s, y) => s + (y - mean) ** 2, 0) / (yields.length - 1)
          : 0;
        const stddev = Math.sqrt(variance);

        // UCL/LCL (3-sigma)
        const ucl = Math.min(mean + 3 * stddev, 100);
        const lcl = Math.max(mean - 3 * stddev, 0);

        // Cpk vs the SPEC limits (yield ∈ [0,100]), NOT the control limits.
        // doc 54 P2.1 — was `min((ucl-mean)/3σ, (mean-lcl)/3σ)` with ucl/lcl = mean±3σ
        // ⇒ 3σ/3σ = 1.0 by construction (control limits used as spec limits) → a
        // fabricated "always-capable" reading. Use USL=100 / LSL=0 so Cpk actually
        // reflects how far the mean yield sits from the bounds relative to spread.
        const YIELD_USL = 100, YIELD_LSL = 0;
        const cpk = stddev > 0
          ? Math.min((YIELD_USL - mean) / (3 * stddev), (mean - YIELD_LSL) / (3 * stddev))
          : 0;

        return {
          stationId: Number(row.stationId),
          stationName: row.stationName,
          stationCode: row.stationCode,
          totalInspections: total,
          fpy: Math.round(fpy * 100) / 100,
          mean: Math.round(mean * 100) / 100,
          stddev: Math.round(stddev * 100) / 100,
          ucl: Math.round(ucl * 100) / 100,
          lcl: Math.round(lcl * 100) / 100,
          cpk: Math.round(cpk * 100) / 100,
          dataPoints: yields.length,
          dailyYields: dailyRows.map(d => ({
            day: String(d.day),
            yield: Math.round(finalYieldPct({ ok: Number(d.ok) || 0, ntf: Number(d.ntf) || 0, total: Number(d.total) || 0 }) * 100) / 100,
          })),
        };
      }));

      return results.filter(Boolean);
    }),

  /**
   * doc 54 P2.5 — Takt / utilization / per-station line-balance for the analytics
   * dashboard. Computes (from real sources, honest-null when data is sparse):
   *   • takt time            = window / demand   (demand = line.capacityPerHour × hours;
   *                            null when no capacity configured — never fabricated)
   *   • actual cycle time    = window / producedUnits
   *   • time utilization     = Σonline / Σ(online+offline)   (machine_status_logs)
   *   • capacity utilization = producedUnits / demand
   *   • per-station balance  = mean/max station cycle time + bottleneck station
   * One row per production line in scope.
   */
  getLineBalance: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      lineId: z.number().optional(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    }))
    .query(async ({ input, ctx }) => {
      const { getLineTaktUtilization } = await import("../services/oeeService");
      // ★ NHÓM B #2 — phạm vi tenant từ `ctx.user` (takt/utilization đọc `daily_statistics`).
      return getLineTaktUtilization({
        lineId: input.lineId,
        factoryId: input.factoryId,
        from: input.startDate,
        to: input.endDate,
        userId: ctx.user?.id,
        userRole: ctx.user?.role,
      });
    }),
});

/** Helper: resolve machine IDs from factory/line filters */
async function resolveMachineIds(
  database: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: { factoryId?: number; lineId?: number },
): Promise<number[]> {
  const stationConditions: SQL[] = [eq(stations.isActive, true)];

  if (input.lineId) {
    stationConditions.push(eq(stations.lineId, input.lineId));
  } else if (input.factoryId) {
    const ws = await database.select({ id: workshops.id })
      .from(workshops)
      .where(eq(workshops.factoryId, input.factoryId));
    if (ws.length === 0) return [];
    const lines = await database.select({ id: productionLines.id })
      .from(productionLines)
      .where(inArray(productionLines.workshopId, ws.map(w => w.id)));
    if (lines.length === 0) return [];
    stationConditions.push(inArray(stations.lineId, lines.map(l => l.id)));
  }

  const stationRows = await database.select({ id: stations.id })
    .from(stations)
    .where(and(...stationConditions));

  if (stationRows.length === 0) return [];

  const machineRows = await database.select({ id: machines.id })
    .from(machines)
    .where(and(
      inArray(machines.stationId, stationRows.map(s => s.id)),
      eq(machines.isActive, true),
    ));

  return machineRows.map(m => m.id);
}

async function getTopDefectsForMachines(
  database: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  machineIds: number[],
  startDate?: Date,
  endDate?: Date,
  limit: number = 3,
) {
  const conditions: SQL[] = [
    eq(measurementResults.result, 'NG'),
    inArray(productInspections.machineId, machineIds),
  ];
  if (startDate) conditions.push(gte(productInspections.inspectionTime, startDate));
  if (endDate) conditions.push(lte(productInspections.inspectionTime, endDate));

  const result = await database.select({
    pointDefId: measurementResults.pointDefId,
    ngCount: sql<number>`count(*)`.as('ng_count'),
  })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(and(...conditions))
    .groupBy(measurementResults.pointDefId)
    .orderBy(desc(sql`ng_count`))
    .limit(limit);

  if (result.length === 0) return [];

  // Get total NG for percentage
  const totalNGResult = await database.select({
    total: sql<number>`count(*)`.as('total'),
  })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(and(...conditions));
  const totalNG = Number(totalNGResult[0]?.total) || 1;

  // Get point definitions
  const pointDefIds = result.map(r => r.pointDefId);
  const pointDefs = await database.select()
    .from(measurementPointDefs)
    .where(inArray(measurementPointDefs.id, pointDefIds));
  const defMap = new Map(pointDefs.map(p => [p.id, p]));

  return result.map(r => {
    const def = defMap.get(r.pointDefId);
    return {
      pointDefId: r.pointDefId,
      code: def?.code || 'Unknown',
      name: def?.name || 'Unknown',
      ngCount: Number(r.ngCount),
      percentage: Math.round((Number(r.ngCount) / totalNG) * 10000) / 100,
    };
  });
}
