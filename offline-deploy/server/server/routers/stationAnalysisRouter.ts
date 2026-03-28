import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db/connection";
import { eq, and, desc, gte, lte, sql, inArray, SQL, asc, isNotNull } from "drizzle-orm";
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
  productMachineMappings,
} from "../../drizzle/schema";

export const stationAnalysisRouter = router({
  /**
   * Station header info + KPI summary.
   */
  getStationSummary: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      // Get station with hierarchy
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
        .where(eq(stations.id, input.stationId))
        .limit(1);

      if (stationRows.length === 0) return null;
      const row = stationRows[0];

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) {
        return {
          ...row,
          machineCount: 0,
          totalInspections: 0,
          okCount: 0,
          ngCount: 0,
          ntfCount: 0,
          firstPassYield: 0,
          finalYield: 0,
          retestRate: 0,
          yieldChange: 0,
        };
      }

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      const stats = await database.select({
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
        ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
      }).from(productInspections).where(and(...conditions));

      const { total: t, ok, ng, ntf } = {
        total: Number(stats[0]?.total) || 0,
        ok: Number(stats[0]?.ok) || 0,
        ng: Number(stats[0]?.ng) || 0,
        ntf: Number(stats[0]?.ntf) || 0,
      };

      const fpy = t > 0 ? Math.round((ok / t) * 10000) / 100 : 0;
      const fy = t > 0 ? Math.round(((ok + ntf) / t) * 10000) / 100 : 0;
      const retest = t > 0 ? Math.round((ntf / t) * 10000) / 100 : 0;

      // Previous period yield change
      let yieldChange = 0;
      if (input.startDate && input.endDate) {
        const duration = input.endDate.getTime() - input.startDate.getTime();
        const prevEnd = new Date(input.startDate.getTime() - 1);
        const prevStart = new Date(prevEnd.getTime() - duration);
        const prevCond: SQL[] = [
          inArray(productInspections.machineId, machineIds),
          gte(productInspections.inspectionTime, prevStart),
          lte(productInspections.inspectionTime, prevEnd),
        ];
        const prev = await database.select({
          total: sql<number>`count(*)`,
          ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        }).from(productInspections).where(and(...prevCond));
        const pt = Number(prev[0]?.total) || 0;
        const po = Number(prev[0]?.ok) || 0;
        const prevFPY = pt > 0 ? (po / pt) * 100 : 0;
        yieldChange = Math.round((fpy - prevFPY) * 100) / 100;
      }

      return {
        ...row,
        machineCount: machineIds.length,
        totalInspections: t,
        okCount: ok,
        ngCount: ng,
        ntfCount: ntf,
        firstPassYield: fpy,
        finalYield: fy,
        retestRate: retest,
        yieldChange,
      };
    }),

  /**
   * Hourly yield breakdown – for heatmap or bar chart.
   */
  getHourlyYield: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return [];

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      const rows = await database.select({
        hour: sql<number>`extract(hour from ${productInspections.inspectionTime})`.as('hour'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...conditions))
        .groupBy(sql`hour`)
        .orderBy(sql`hour`);

      return rows.map(r => {
        const total = Number(r.total) || 0;
        const ok = Number(r.ok) || 0;
        return {
          hour: Number(r.hour),
          total,
          ok,
          ng: Number(r.ng) || 0,
          yield: total > 0 ? Math.round((ok / total) * 10000) / 100 : 0,
        };
      });
    }),

  /**
   * Defect Pareto for this specific station.
   */
  getStationDefects: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return [];

      const conditions: SQL[] = [
        eq(measurementResults.result, 'NG'),
        inArray(productInspections.machineId, machineIds),
      ];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      const byType = await database.select({
        pointDefId: measurementResults.pointDefId,
        ngCount: sql<number>`count(*)`.as('ng_count'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conditions))
        .groupBy(measurementResults.pointDefId)
        .orderBy(desc(sql`ng_count`))
        .limit(20);

      const totalNG = byType.reduce((s, r) => s + Number(r.ngCount), 0) || 1;
      const pointDefIds = byType.map(r => r.pointDefId);
      const pointDefs = pointDefIds.length > 0
        ? await database.select().from(measurementPointDefs).where(inArray(measurementPointDefs.id, pointDefIds))
        : [];
      const defMap = new Map(pointDefs.map(p => [p.id, p]));

      let cumPct = 0;
      return byType.map(r => {
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
    }),

  /**
   * Daily yield time series for SPC control chart.
   */
  getYieldControlChart: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { points: [], mean: 0, ucl: 100, lcl: 0, stddev: 0, cpk: 0, ppk: 0 };

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { points: [], mean: 0, ucl: 100, lcl: 0, stddev: 0, cpk: 0, ppk: 0 };

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      const dailyRows = await database.select({
        day: sql`date_trunc('day', ${productInspections.inspectionTime})`.as('day'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...conditions))
        .groupBy(sql`day`)
        .orderBy(sql`day`);

      const points = dailyRows.map(d => {
        const total = Number(d.total) || 0;
        const ok = Number(d.ok) || 0;
        return {
          day: String(d.day),
          total,
          ok,
          ng: Number(d.ng) || 0,
          yield: total > 0 ? Math.round((ok / total) * 10000) / 100 : 0,
        };
      });

      const yields = points.map(p => p.yield);
      const n = yields.length;
      const mean = n > 0 ? yields.reduce((a, b) => a + b, 0) / n : 0;
      const variance = n > 1 ? yields.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1) : 0;
      const stddev = Math.sqrt(variance);
      const ucl = Math.min(mean + 3 * stddev, 100);
      const lcl = Math.max(mean - 3 * stddev, 0);

      // Cpk (process target = 100% yield, USL = 100, LSL = specification lower)
      // Simplified: use distance to nearest spec limit
      const cpk = stddev > 0 ? Math.min((100 - mean) / (3 * stddev), (mean - 0) / (3 * stddev)) : 0;

      // Ppk (using overall stddev instead of within-subgroup)
      const ppk = cpk; // simplified: same as Cpk for daily aggregation

      // Moving range for Western Electric rules
      const movingRanges: number[] = [];
      for (let i = 1; i < yields.length; i++) {
        movingRanges.push(Math.abs(yields[i] - yields[i - 1]));
      }
      const avgMR = movingRanges.length > 0 ? movingRanges.reduce((a, b) => a + b, 0) / movingRanges.length : 0;

      // ── Zone classification ──
      const zoneOf = (y: number) =>
        y > ucl ? 'above' as const
          : y < lcl ? 'below' as const
          : y > mean + 2 * stddev ? 'A+' as const
          : y < mean - 2 * stddev ? 'A-' as const
          : y > mean + stddev ? 'B+' as const
          : y < mean - stddev ? 'B-' as const
          : 'C' as const;

      // ── All 8 Western Electric Rules ──
      function detectWesternElectricRules(yields: number[], mean: number, stddev: number, ucl: number, lcl: number) {
        const n = yields.length;
        const violations: { index: number; rules: number[] }[] = [];
        const ruleMap = new Map<number, number[]>(); // index → rules
        const addViolation = (idx: number, rule: number) => {
          if (!ruleMap.has(idx)) ruleMap.set(idx, []);
          ruleMap.get(idx)!.push(rule);
        };

        for (let i = 0; i < n; i++) {
          const y = yields[i];
          // Rule 1: 1 point beyond 3σ (outside control limits)
          if (y > ucl || y < lcl) addViolation(i, 1);

          // Rule 2: 9 consecutive points on same side of center
          if (i >= 8) {
            const last9 = yields.slice(i - 8, i + 1);
            const allAbove = last9.every(v => v > mean);
            const allBelow = last9.every(v => v < mean);
            if (allAbove || allBelow) for (let j = i - 8; j <= i; j++) addViolation(j, 2);
          }

          // Rule 3: 6 consecutive points steadily increasing or decreasing
          if (i >= 5) {
            const last6 = yields.slice(i - 5, i + 1);
            let allInc = true, allDec = true;
            for (let j = 1; j < last6.length; j++) {
              if (last6[j] <= last6[j - 1]) allInc = false;
              if (last6[j] >= last6[j - 1]) allDec = false;
            }
            if (allInc || allDec) for (let j = i - 5; j <= i; j++) addViolation(j, 3);
          }

          // Rule 4: 14 consecutive points alternating up and down
          if (i >= 13) {
            const last14 = yields.slice(i - 13, i + 1);
            let alternating = true;
            for (let j = 2; j < last14.length; j++) {
              const dir1 = last14[j - 1] - last14[j - 2];
              const dir2 = last14[j] - last14[j - 1];
              if (dir1 * dir2 >= 0) { alternating = false; break; }
            }
            if (alternating) for (let j = i - 13; j <= i; j++) addViolation(j, 4);
          }

          // Rule 5: 2 of 3 consecutive points beyond 2σ on same side
          if (i >= 2) {
            const last3 = yields.slice(i - 2, i + 1);
            const above2s = last3.filter(v => v > mean + 2 * stddev).length;
            const below2s = last3.filter(v => v < mean - 2 * stddev).length;
            if (above2s >= 2 || below2s >= 2) for (let j = i - 2; j <= i; j++) addViolation(j, 5);
          }

          // Rule 6: 4 of 5 consecutive points beyond 1σ on same side
          if (i >= 4) {
            const last5 = yields.slice(i - 4, i + 1);
            const above1s = last5.filter(v => v > mean + stddev).length;
            const below1s = last5.filter(v => v < mean - stddev).length;
            if (above1s >= 4 || below1s >= 4) for (let j = i - 4; j <= i; j++) addViolation(j, 6);
          }

          // Rule 7: 15 consecutive points within 1σ (both sides) — stratification
          if (i >= 14) {
            const last15 = yields.slice(i - 14, i + 1);
            const allInC = last15.every(v => Math.abs(v - mean) <= stddev);
            if (allInC) for (let j = i - 14; j <= i; j++) addViolation(j, 7);
          }

          // Rule 8: 8 consecutive points beyond 1σ on BOTH sides (mixture)
          if (i >= 7) {
            const last8 = yields.slice(i - 7, i + 1);
            const allOutC = last8.every(v => Math.abs(v - mean) > stddev);
            if (allOutC) for (let j = i - 7; j <= i; j++) addViolation(j, 8);
          }
        }

        return ruleMap;
      }

      const weViolations = stddev > 0
        ? detectWesternElectricRules(yields, mean, stddev, ucl, lcl)
        : new Map<number, number[]>();

      const RULE_NAMES: Record<number, string> = {
        1: 'Point beyond 3σ',
        2: '9 consecutive same side',
        3: '6 consecutive trending',
        4: '14 alternating up/down',
        5: '2 of 3 beyond 2σ',
        6: '4 of 5 beyond 1σ',
        7: '15 within 1σ (stratification)',
        8: '8 beyond 1σ both sides (mixture)',
      };

      const enhancedPoints = points.map((p, i) => {
        const rules = weViolations.get(i) || [];
        const uniqueRules = [...new Set(rules)];
        return {
          ...p,
          outOfControl: uniqueRules.length > 0,
          zone: zoneOf(p.yield),
          movingRange: i > 0 ? movingRanges[i - 1] : 0,
          violatedRules: uniqueRules,
          ruleDescriptions: uniqueRules.map(r => RULE_NAMES[r] || `Rule ${r}`),
        };
      });

      // Rule violation summary
      const ruleSummary: { rule: number; name: string; count: number }[] = [];
      for (let r = 1; r <= 8; r++) {
        const count = enhancedPoints.filter(p => p.violatedRules.includes(r)).length;
        if (count > 0) ruleSummary.push({ rule: r, name: RULE_NAMES[r], count });
      }

      return {
        points: enhancedPoints,
        mean: Math.round(mean * 100) / 100,
        ucl: Math.round(ucl * 100) / 100,
        lcl: Math.round(lcl * 100) / 100,
        stddev: Math.round(stddev * 100) / 100,
        cpk: Math.round(cpk * 100) / 100,
        ppk: Math.round(ppk * 100) / 100,
        avgMovingRange: Math.round(avgMR * 100) / 100,
        ruleSummary,
      };
    }),

  /**
   * Recent NG inspection history with details.
   */
  getFailHistory: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return [];

      const conditions: SQL[] = [
        inArray(productInspections.machineId, machineIds),
        eq(productInspections.overallResult, 'NG'),
      ];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      const inspections = await database.select({
        id: productInspections.id,
        barcode: productInspections.serialNumber,
        inspectionTime: productInspections.inspectionTime,
        overallResult: productInspections.overallResult,
        machineId: productInspections.machineId,
        machineName: machines.name,
        machineCode: machines.code,
      })
        .from(productInspections)
        .innerJoin(machines, eq(productInspections.machineId, machines.id))
        .where(and(...conditions))
        .orderBy(desc(productInspections.inspectionTime))
        .limit(input.limit);

      // Get measurement results for each inspection
      if (inspections.length === 0) return [];

      const inspIds = inspections.map(i => i.id);
      const measResults = await database.select({
        inspectionId: measurementResults.inspectionId,
        pointDefId: measurementResults.pointDefId,
        result: measurementResults.result,
        measuredValue: measurementResults.measuredValue,
        pointCode: measurementPointDefs.code,
        pointName: measurementPointDefs.name,
      })
        .from(measurementResults)
        .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
        .where(and(
          inArray(measurementResults.inspectionId, inspIds),
          eq(measurementResults.result, 'NG'),
        ));

      const measMap = new Map<number, typeof measResults>();
      for (const m of measResults) {
        const arr = measMap.get(m.inspectionId) || [];
        arr.push(m);
        measMap.set(m.inspectionId, arr);
      }

      return inspections.map(insp => ({
        ...insp,
        failedPoints: measMap.get(insp.id) || [],
      }));
    }),

  /**
   * AI diagnostic analysis — pattern detection and root cause suggestions.
   */
  getDiagnostics: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { alerts: [], patterns: [], recommendations: [] };

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { alerts: [], patterns: [], recommendations: [] };

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      // Get overall stats
      const stats = await database.select({
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
        ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
      }).from(productInspections).where(and(...conditions));

      const total = Number(stats[0]?.total) || 0;
      const ok = Number(stats[0]?.ok) || 0;
      const ng = Number(stats[0]?.ng) || 0;
      const ntf = Number(stats[0]?.ntf) || 0;
      const fpy = total > 0 ? (ok / total) * 100 : 0;
      const retestRate = total > 0 ? (ntf / total) * 100 : 0;

      // Daily yield for trend analysis
      const dailyRows = await database.select({
        day: sql`date_trunc('day', ${productInspections.inspectionTime})`.as('day'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...conditions))
        .groupBy(sql`day`)
        .orderBy(sql`day`);

      const dailyYields = dailyRows.map(d => {
        const t = Number(d.total) || 0;
        const o = Number(d.ok) || 0;
        return { day: String(d.day), yield: t > 0 ? (o / t) * 100 : 0 };
      });

      // Hourly pattern for shift analysis
      const hourlyRows = await database.select({
        hour: sql<number>`extract(hour from ${productInspections.inspectionTime})`.as('hour'),
        total: sql<number>`count(*)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...conditions))
        .groupBy(sql`hour`)
        .orderBy(sql`hour`);

      // Top defects for pattern analysis
      const ngConditions: SQL[] = [
        eq(measurementResults.result, 'NG'),
        inArray(productInspections.machineId, machineIds),
      ];
      if (input.startDate) ngConditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) ngConditions.push(lte(productInspections.inspectionTime, input.endDate));

      const topDefects = await database.select({
        pointDefId: measurementResults.pointDefId,
        ngCount: sql<number>`count(*)`.as('ng_count'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...ngConditions))
        .groupBy(measurementResults.pointDefId)
        .orderBy(desc(sql`ng_count`))
        .limit(5);

      const pointDefIds = topDefects.map(r => r.pointDefId);
      const pointDefs = pointDefIds.length > 0
        ? await database.select().from(measurementPointDefs).where(inArray(measurementPointDefs.id, pointDefIds))
        : [];
      const defMap = new Map(pointDefs.map(p => [p.id, p]));

      // ── Generate diagnostics ──
      const alerts: { severity: 'critical' | 'warning' | 'info'; title: string; description: string }[] = [];
      const patterns: { type: string; description: string; confidence: number }[] = [];
      const recommendations: { priority: 'high' | 'medium' | 'low'; action: string; rationale: string }[] = [];

      // Alert: Low yield
      if (fpy < 70) {
        alerts.push({
          severity: 'critical',
          title: 'Critical yield alert',
          description: `First pass yield is ${fpy.toFixed(1)}%, significantly below the 90% threshold. Immediate investigation required.`,
        });
      } else if (fpy < 90) {
        alerts.push({
          severity: 'warning',
          title: 'Yield below target',
          description: `First pass yield is ${fpy.toFixed(1)}%, below the 90% target. Review top defects for improvement opportunities.`,
        });
      }

      // Alert: High retest rate
      if (retestRate > 10) {
        alerts.push({
          severity: 'warning',
          title: 'High retest rate',
          description: `Retest rate is ${retestRate.toFixed(1)}%. This may mask underlying quality issues. Consider tightening inspection criteria.`,
        });
      }

      // Pattern: Yield trend (check last 5 days for declining trend)
      if (dailyYields.length >= 5) {
        const recent = dailyYields.slice(-5);
        let declining = 0;
        for (let i = 1; i < recent.length; i++) {
          if (recent[i].yield < recent[i - 1].yield) declining++;
        }
        if (declining >= 4) {
          patterns.push({
            type: 'Declining trend',
            description: `Yield has been declining for ${declining} consecutive days. This suggests a progressive degradation in process quality.`,
            confidence: 0.85,
          });
          alerts.push({
            severity: 'warning',
            title: 'Continuous yield decline detected',
            description: `Yield has declined for ${declining} of the last 5 days. Check for equipment wear, material changes, or calibration drift.`,
          });
        }
      }

      // Pattern: Shift-dependent quality
      const shiftHours = {
        morning: hourlyRows.filter(h => Number(h.hour) >= 6 && Number(h.hour) < 14),
        afternoon: hourlyRows.filter(h => Number(h.hour) >= 14 && Number(h.hour) < 22),
        night: hourlyRows.filter(h => Number(h.hour) >= 22 || Number(h.hour) < 6),
      };

      const shiftNG: Record<string, number> = {};
      const shiftTotal: Record<string, number> = {};
      for (const [shift, hours] of Object.entries(shiftHours)) {
        shiftNG[shift] = hours.reduce((s, h) => s + Number(h.ng), 0);
        shiftTotal[shift] = hours.reduce((s, h) => s + Number(h.total), 0);
      }

      const shiftYields = Object.entries(shiftTotal).map(([shift, total]) => ({
        shift,
        yield: total > 0 ? ((total - (shiftNG[shift] || 0)) / total) * 100 : 0,
        total,
      })).filter(s => s.total > 0);

      if (shiftYields.length >= 2) {
        const maxY = Math.max(...shiftYields.map(s => s.yield));
        const minY = Math.min(...shiftYields.map(s => s.yield));
        if (maxY - minY > 10) {
          const worst = shiftYields.reduce((a, b) => a.yield < b.yield ? a : b);
          patterns.push({
            type: 'Shift variation',
            description: `Significant yield variation between shifts (${(maxY - minY).toFixed(1)}% difference). ${worst.shift} shift has the lowest yield at ${worst.yield.toFixed(1)}%.`,
            confidence: 0.75,
          });
        }
      }

      // Pattern: Dominant defect
      if (topDefects.length > 0) {
        const topDef = topDefects[0];
        const totalDefects = topDefects.reduce((s, d) => s + Number(d.ngCount), 0);
        const topPct = totalDefects > 0 ? (Number(topDef.ngCount) / totalDefects) * 100 : 0;
        const defInfo = defMap.get(topDef.pointDefId);

        if (topPct > 50) {
          patterns.push({
            type: 'Dominant defect',
            description: `"${defInfo?.name || 'Unknown'}" accounts for ${topPct.toFixed(0)}% of all defects. Focusing on this single defect type would have the highest impact.`,
            confidence: 0.9,
          });
        }
      }

      // Recommendations
      if (topDefects.length > 0) {
        const topDef = defMap.get(topDefects[0].pointDefId);
        recommendations.push({
          priority: 'high',
          action: `Investigate top defect: ${topDef?.name || 'Unknown'} (${topDef?.code || ''})`,
          rationale: `This is the most frequent defect type. Root cause analysis on this defect will have the highest impact on yield improvement.`,
        });
      }

      if (fpy < 90) {
        recommendations.push({
          priority: 'high',
          action: 'Review inspection criteria and thresholds',
          rationale: `With FPY at ${fpy.toFixed(1)}%, verify that measurement thresholds are correctly calibrated and aligned with product specifications.`,
        });
      }

      if (retestRate > 5) {
        recommendations.push({
          priority: 'medium',
          action: 'Audit retest procedure',
          rationale: `Retest rate of ${retestRate.toFixed(1)}% suggests possible over-reliance on re-inspection. Consider if root causes are being properly addressed.`,
        });
      }

      if (shiftYields.length >= 2) {
        const worst = shiftYields.reduce((a, b) => a.yield < b.yield ? a : b);
        if (worst.yield < 90) {
          recommendations.push({
            priority: 'medium',
            action: `Review ${worst.shift} shift procedures and training`,
            rationale: `The ${worst.shift} shift shows lower yield (${worst.yield.toFixed(1)}%). Training or procedure differences may be contributing.`,
          });
        }
      }

      recommendations.push({
        priority: 'low',
        action: 'Schedule preventive maintenance check',
        rationale: 'Regular equipment maintenance helps prevent yield degradation over time.',
      });

      return { alerts, patterns, recommendations };
    }),

  /* ═════════════════════════════════════════════════════════════
     7 QC TOOLS — Additional procedures
     ═════════════════════════════════════════════════════════════ */

  /**
   * Histogram — distribution of yield values across bins.
   */
  getHistogramData: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      bins: z.number().min(5).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { bins: [], stats: { mean: 0, median: 0, mode: 0, stddev: 0, skewness: 0, kurtosis: 0, n: 0, min: 0, max: 0 } };

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { bins: [], stats: { mean: 0, median: 0, mode: 0, stddev: 0, skewness: 0, kurtosis: 0, n: 0, min: 0, max: 0 } };

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      const dailyRows = await database.select({
        day: sql`date_trunc('day', ${productInspections.inspectionTime})`.as('day'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...conditions))
        .groupBy(sql`day`)
        .orderBy(sql`day`);

      const yields = dailyRows.map(d => {
        const total = Number(d.total) || 0;
        const ok = Number(d.ok) || 0;
        return total > 0 ? (ok / total) * 100 : 0;
      }).filter(y => y > 0);

      if (yields.length === 0) return { bins: [], stats: { mean: 0, median: 0, mode: 0, stddev: 0, skewness: 0, kurtosis: 0, n: 0, min: 0, max: 0 } };

      const n = yields.length;
      const sorted = [...yields].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[n - 1];
      const mean = yields.reduce((a, b) => a + b, 0) / n;
      const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
      const variance = yields.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1 || 1);
      const stddev = Math.sqrt(variance);
      const skewness = n > 2 ? (n / ((n - 1) * (n - 2))) * yields.reduce((s, y) => s + ((y - mean) / stddev) ** 3, 0) : 0;
      const kurtosis = n > 3 ? ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * yields.reduce((s, y) => s + ((y - mean) / stddev) ** 4, 0)
        - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)) : 0;

      // Mode (rounded to 1 decimal)
      const freqMap = new Map<number, number>();
      for (const y of yields) {
        const rounded = Math.round(y * 10) / 10;
        freqMap.set(rounded, (freqMap.get(rounded) || 0) + 1);
      }
      let mode = mean;
      let maxFreq = 0;
      for (const [val, freq] of freqMap) {
        if (freq > maxFreq) { maxFreq = freq; mode = val; }
      }

      // Build histogram bins
      const binWidth = (max - min) / input.bins || 1;
      const bins: { binStart: number; binEnd: number; count: number; label: string }[] = [];
      for (let i = 0; i < input.bins; i++) {
        const binStart = min + i * binWidth;
        const binEnd = binStart + binWidth;
        const count = yields.filter(y => y >= binStart && (i === input.bins - 1 ? y <= binEnd : y < binEnd)).length;
        bins.push({
          binStart: Math.round(binStart * 100) / 100,
          binEnd: Math.round(binEnd * 100) / 100,
          count,
          label: `${binStart.toFixed(1)}-${binEnd.toFixed(1)}`,
        });
      }

      // Normal distribution overlay
      const normalBins = bins.map(b => {
        const midpoint = (b.binStart + b.binEnd) / 2;
        const normalDensity = (1 / (stddev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((midpoint - mean) / stddev) ** 2);
        return { ...b, normalCount: Math.round(normalDensity * n * binWidth * 100) / 100 };
      });

      return {
        bins: normalBins,
        stats: {
          mean: Math.round(mean * 100) / 100,
          median: Math.round(median * 100) / 100,
          mode: Math.round(mode * 100) / 100,
          stddev: Math.round(stddev * 100) / 100,
          skewness: Math.round(skewness * 100) / 100,
          kurtosis: Math.round(kurtosis * 100) / 100,
          n,
          min: Math.round(min * 100) / 100,
          max: Math.round(max * 100) / 100,
        },
      };
    }),

  /**
   * Scatter Diagram — correlation between two variables (output vs NG rate per hour).
   */
  getScatterData: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { points: [], correlation: 0, rSquared: 0, trendLine: { slope: 0, intercept: 0 } };

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { points: [], correlation: 0, rSquared: 0, trendLine: { slope: 0, intercept: 0 } };

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      // Hourly data: total output (X) vs NG rate (Y)
      const hourlyRows = await database.select({
        bucket: sql`date_trunc('hour', ${productInspections.inspectionTime})`.as('bucket'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...conditions))
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket`);

      const points = hourlyRows.map(r => {
        const total = Number(r.total) || 0;
        const ng = Number(r.ng) || 0;
        return {
          x: total, // output volume
          y: total > 0 ? Math.round((ng / total) * 10000) / 100 : 0, // NG rate %
          label: String(r.bucket),
        };
      }).filter(p => p.x > 0);

      if (points.length < 2) return { points, correlation: 0, rSquared: 0, trendLine: { slope: 0, intercept: 0 } };

      // Calculate Pearson correlation coefficient
      const n = points.length;
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const meanX = xs.reduce((a, b) => a + b, 0) / n;
      const meanY = ys.reduce((a, b) => a + b, 0) / n;
      const sumXY = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
      const sumX2 = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
      const sumY2 = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
      const r = sumX2 > 0 && sumY2 > 0 ? sumXY / Math.sqrt(sumX2 * sumY2) : 0;

      // Linear regression
      const slope = sumX2 > 0 ? sumXY / sumX2 : 0;
      const intercept = meanY - slope * meanX;

      return {
        points,
        correlation: Math.round(r * 1000) / 1000,
        rSquared: Math.round(r * r * 1000) / 1000,
        trendLine: { slope: Math.round(slope * 10000) / 10000, intercept: Math.round(intercept * 100) / 100 },
      };
    }),

  /**
   * Check Sheet — structured data collection summary by defect type × time period.
   */
  getCheckSheetData: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { matrix: [], defectTypes: [], periods: [], totals: { byDefect: {}, byPeriod: {}, grand: 0 } };

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { matrix: [], defectTypes: [], periods: [], totals: { byDefect: {}, byPeriod: {}, grand: 0 } };

      const conditions: SQL[] = [
        eq(measurementResults.result, 'NG'),
        inArray(productInspections.machineId, machineIds),
      ];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      const rows = await database.select({
        pointDefId: measurementResults.pointDefId,
        day: sql<string>`to_char(date_trunc('day', ${productInspections.inspectionTime}), 'YYYY-MM-DD')`.as('day'),
        ngCount: sql<number>`count(*)`.as('ng_count'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conditions))
        .groupBy(measurementResults.pointDefId, sql`day`)
        .orderBy(sql`day`);

      // Get point def names
      const defIds = [...new Set(rows.map(r => r.pointDefId))];
      const pointDefs = defIds.length > 0
        ? await database.select().from(measurementPointDefs).where(inArray(measurementPointDefs.id, defIds))
        : [];
      const defMap = new Map(pointDefs.map(p => [p.id, { code: p.code, name: p.name }]));

      const periods = [...new Set(rows.map(r => r.day))].sort();
      const defectTypes = defIds.map(id => ({ id, ...(defMap.get(id) || { code: 'UNK', name: 'Unknown' }) }));

      // Build matrix
      const matrix = periods.map(period => {
        const row: Record<string, number> = { period: 0 };
        for (const dt of defectTypes) {
          const found = rows.find(r => r.pointDefId === dt.id && r.day === period);
          row[`d${dt.id}`] = Number(found?.ngCount) || 0;
        }
        return { period, ...row };
      });

      const byDefect: Record<string, number> = {};
      const byPeriod: Record<string, number> = {};
      let grand = 0;
      for (const r of rows) {
        const key = `d${r.pointDefId}`;
        byDefect[key] = (byDefect[key] || 0) + Number(r.ngCount);
        byPeriod[r.day] = (byPeriod[r.day] || 0) + Number(r.ngCount);
        grand += Number(r.ngCount);
      }

      return { matrix, defectTypes, periods, totals: { byDefect, byPeriod, grand } };
    }),

  /**
   * Cause-Effect (Ishikawa) — structured root cause candidates.
   */
  getCauseEffectData: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { categories: [], topDefect: null };

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { categories: [], topDefect: null };

      const conditions: SQL[] = [
        eq(measurementResults.result, 'NG'),
        inArray(productInspections.machineId, machineIds),
      ];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      // Get top defect
      const topDefects = await database.select({
        pointDefId: measurementResults.pointDefId,
        ngCount: sql<number>`count(*)`.as('ng_count'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(...conditions))
        .groupBy(measurementResults.pointDefId)
        .orderBy(desc(sql`ng_count`))
        .limit(1);

      let topDefect: { code: string; name: string; count: number } | null = null;
      if (topDefects.length > 0) {
        const defs = await database.select().from(measurementPointDefs).where(eq(measurementPointDefs.id, topDefects[0].pointDefId));
        topDefect = {
          code: defs[0]?.code || 'Unknown',
          name: defs[0]?.name || 'Unknown',
          count: Number(topDefects[0].ngCount),
        };
      }

      // Get shift data for Man category
      const shiftRows = await database.select({
        shift: sql<string>`case
          when extract(hour from ${productInspections.inspectionTime}) >= 6 and extract(hour from ${productInspections.inspectionTime}) < 14 then 'Morning'
          when extract(hour from ${productInspections.inspectionTime}) >= 14 and extract(hour from ${productInspections.inspectionTime}) < 22 then 'Afternoon'
          else 'Night' end`.as('shift'),
        total: sql<number>`count(*)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(inArray(productInspections.machineId, machineIds),
          ...(input.startDate ? [gte(productInspections.inspectionTime, input.startDate)] : []),
          ...(input.endDate ? [lte(productInspections.inspectionTime, input.endDate)] : [])))
        .groupBy(sql`shift`);

      // Get machine data for Machine category
      const machineRows = await database.select({
        machineCode: machines.code,
        machineName: machines.name,
        total: sql<number>`count(*)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .innerJoin(machines, eq(productInspections.machineId, machines.id))
        .where(and(inArray(productInspections.machineId, machineIds),
          ...(input.startDate ? [gte(productInspections.inspectionTime, input.startDate)] : []),
          ...(input.endDate ? [lte(productInspections.inspectionTime, input.endDate)] : [])))
        .groupBy(machines.code, machines.name);

      // Build 6M Ishikawa categories with data-driven sub-causes
      const categories = [
        {
          name: 'Man (People)',
          icon: '👤',
          causes: [
            ...shiftRows.map(s => {
              const ngRate = Number(s.total) > 0 ? (Number(s.ng) / Number(s.total) * 100).toFixed(1) : '0';
              return { cause: `${s.shift} shift`, detail: `NG rate: ${ngRate}%`, severity: Number(ngRate) > 5 ? 'high' as const : Number(ngRate) > 2 ? 'medium' as const : 'low' as const };
            }),
            { cause: 'Operator training level', detail: 'Require periodic skill assessment', severity: 'medium' as const },
          ],
        },
        {
          name: 'Machine',
          icon: '⚙️',
          causes: [
            ...machineRows.map(m => {
              const ngRate = Number(m.total) > 0 ? (Number(m.ng) / Number(m.total) * 100).toFixed(1) : '0';
              return { cause: `${m.machineCode}: ${m.machineName}`, detail: `NG rate: ${ngRate}%`, severity: Number(ngRate) > 5 ? 'high' as const : Number(ngRate) > 2 ? 'medium' as const : 'low' as const };
            }),
            { cause: 'Calibration drift', detail: 'Check measurement equipment calibration', severity: 'medium' as const },
          ],
        },
        {
          name: 'Material',
          icon: '📦',
          causes: [
            { cause: 'Raw material quality variation', detail: 'Track supplier lot numbers vs defect rates', severity: 'medium' as const },
            { cause: 'Material storage conditions', detail: 'Check temperature and humidity compliance', severity: 'low' as const },
          ],
        },
        {
          name: 'Method',
          icon: '📋',
          causes: [
            { cause: 'Standard procedure compliance', detail: 'Verify SOP adherence across shifts', severity: 'medium' as const },
            { cause: 'Inspection criteria ambiguity', detail: 'Review measurement point specifications', severity: 'medium' as const },
          ],
        },
        {
          name: 'Measurement',
          icon: '📏',
          causes: topDefect ? [
            { cause: `Top defect: ${topDefect.code}`, detail: `${topDefect.name} — ${topDefect.count} occurrences`, severity: 'high' as const },
            { cause: 'Measurement repeatability', detail: 'Run Gage R&R study on critical points', severity: 'medium' as const },
          ] : [
            { cause: 'Measurement system accuracy', detail: 'Run Gage R&R study', severity: 'medium' as const },
          ],
        },
        {
          name: 'Environment',
          icon: '🌡️',
          causes: [
            { cause: 'Temperature variation', detail: 'Monitor production area temperature logs', severity: 'low' as const },
            { cause: 'Vibration / ESD', detail: 'Check environmental controls', severity: 'low' as const },
          ],
        },
      ];

      return { categories, topDefect };
    }),

  /**
   * Stratification — breakdown by machine, shift, and defect type.
   */
  getStratificationData: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { byMachine: [], byShift: [], byDay: [] };

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { byMachine: [], byShift: [], byDay: [] };

      const baseCond: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) baseCond.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) baseCond.push(lte(productInspections.inspectionTime, input.endDate));

      // By Machine
      const byMachine = await database.select({
        machineCode: machines.code,
        machineName: machines.name,
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
        ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
      })
        .from(productInspections)
        .innerJoin(machines, eq(productInspections.machineId, machines.id))
        .where(and(...baseCond))
        .groupBy(machines.code, machines.name)
        .orderBy(desc(sql`count(*)`));

      // By Shift (Morning 6-14, Afternoon 14-22, Night 22-6)
      const byShift = await database.select({
        shift: sql<string>`case
          when extract(hour from ${productInspections.inspectionTime}) >= 6 and extract(hour from ${productInspections.inspectionTime}) < 14 then 'Morning'
          when extract(hour from ${productInspections.inspectionTime}) >= 14 and extract(hour from ${productInspections.inspectionTime}) < 22 then 'Afternoon'
          else 'Night' end`.as('shift'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
        ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...baseCond))
        .groupBy(sql`shift`)
        .orderBy(sql`shift`);

      // By Day of Week
      const byDay = await database.select({
        dayOfWeek: sql<number>`extract(dow from ${productInspections.inspectionTime})`.as('dow'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...baseCond))
        .groupBy(sql`dow`)
        .orderBy(sql`dow`);

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      return {
        byMachine: byMachine.map(m => ({
          machineCode: m.machineCode,
          machineName: m.machineName,
          total: Number(m.total),
          ok: Number(m.ok),
          ng: Number(m.ng),
          ntf: Number(m.ntf),
          yield: Number(m.total) > 0 ? Math.round((Number(m.ok) / Number(m.total)) * 10000) / 100 : 0,
        })),
        byShift: byShift.map(s => ({
          shift: s.shift,
          total: Number(s.total),
          ok: Number(s.ok),
          ng: Number(s.ng),
          ntf: Number(s.ntf),
          yield: Number(s.total) > 0 ? Math.round((Number(s.ok) / Number(s.total)) * 10000) / 100 : 0,
        })),
        byDay: byDay.map(d => ({
          day: dayNames[Number(d.dayOfWeek)] || `Day ${d.dayOfWeek}`,
          total: Number(d.total),
          ok: Number(d.ok),
          ng: Number(d.ng),
          yield: Number(d.total) > 0 ? Math.round((Number(d.ok) / Number(d.total)) * 10000) / 100 : 0,
        })),
      };
    }),

  /**
   * AI-powered statistical analysis using server-side computations.
   * Pure statistical ML: anomaly detection, forecasting, clustering — no external AI service.
   */
  getAiAnalysis: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { anomalies: [], forecast: [], clusters: [], insights: [], processCapability: null };

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { anomalies: [], forecast: [], clusters: [], insights: [], processCapability: null };

      const conditions: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) conditions.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) conditions.push(lte(productInspections.inspectionTime, input.endDate));

      // Fetch daily yields
      const dailyRows = await database.select({
        day: sql`date_trunc('day', ${productInspections.inspectionTime})`.as('day'),
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
        ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      })
        .from(productInspections)
        .where(and(...conditions))
        .groupBy(sql`day`)
        .orderBy(sql`day`);

      const dailyData = dailyRows.map(d => ({
        day: String(d.day),
        total: Number(d.total) || 0,
        ok: Number(d.ok) || 0,
        ng: Number(d.ng) || 0,
        yield: Number(d.total) > 0 ? (Number(d.ok) / Number(d.total)) * 100 : 0,
      }));

      const yields = dailyData.map(d => d.yield);
      const n = yields.length;

      if (n < 3) return { anomalies: [], forecast: [], clusters: [], insights: [], processCapability: null };

      const mean = yields.reduce((a, b) => a + b, 0) / n;
      const stddev = Math.sqrt(yields.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1 || 1));

      // ── 1. Anomaly Detection (Modified Z-Score using MAD) ──
      const medianYield = [...yields].sort((a, b) => a - b)[Math.floor(n / 2)];
      const mad = [...yields].map(y => Math.abs(y - medianYield)).sort((a, b) => a - b)[Math.floor(n / 2)];
      const anomalies = dailyData.map((d, i) => {
        const mzScore = mad > 0 ? 0.6745 * (d.yield - medianYield) / mad : 0;
        return {
          day: d.day,
          yield: Math.round(d.yield * 100) / 100,
          zScore: Math.round(mzScore * 100) / 100,
          isAnomaly: Math.abs(mzScore) > 3.5,
          type: mzScore > 3.5 ? 'unusually_high' as const : mzScore < -3.5 ? 'unusually_low' as const : 'normal' as const,
        };
      }).filter(a => a.isAnomaly);

      // ── 2. Simple Forecasting (Exponential Smoothing) ──
      const alpha = 0.3; // smoothing factor
      const forecast: { day: string; predicted: number; lower: number; upper: number }[] = [];
      let level = yields[0];
      for (let i = 1; i < n; i++) {
        level = alpha * yields[i] + (1 - alpha) * level;
      }
      // Predict next 7 days
      const lastDate = new Date(dailyData[n - 1].day);
      const predStddev = stddev * 1.2; // wider confidence interval for prediction
      for (let i = 1; i <= 7; i++) {
        const predDate = new Date(lastDate);
        predDate.setDate(predDate.getDate() + i);
        forecast.push({
          day: predDate.toISOString().split('T')[0],
          predicted: Math.round(Math.min(100, Math.max(0, level)) * 100) / 100,
          lower: Math.round(Math.max(0, level - 1.96 * predStddev) * 100) / 100,
          upper: Math.round(Math.min(100, level + 1.96 * predStddev) * 100) / 100,
        });
      }

      // ── 3. K-means style clustering of daily performance ──
      const clusters: { id: number; label: string; centroid: number; count: number; days: string[] }[] = [];
      if (n >= 5) {
        // Simple 3-cluster: low, medium, high yield days
        const threshLow = mean - stddev;
        const threshHigh = mean + stddev;
        const lowDays = dailyData.filter(d => d.yield < threshLow);
        const medDays = dailyData.filter(d => d.yield >= threshLow && d.yield <= threshHigh);
        const highDays = dailyData.filter(d => d.yield > threshHigh);

        if (lowDays.length > 0) clusters.push({
          id: 0, label: 'Low Performance', count: lowDays.length,
          centroid: Math.round((lowDays.reduce((s, d) => s + d.yield, 0) / lowDays.length) * 100) / 100,
          days: lowDays.map(d => d.day),
        });
        if (medDays.length > 0) clusters.push({
          id: 1, label: 'Normal Performance', count: medDays.length,
          centroid: Math.round((medDays.reduce((s, d) => s + d.yield, 0) / medDays.length) * 100) / 100,
          days: medDays.map(d => d.day),
        });
        if (highDays.length > 0) clusters.push({
          id: 2, label: 'High Performance', count: highDays.length,
          centroid: Math.round((highDays.reduce((s, d) => s + d.yield, 0) / highDays.length) * 100) / 100,
          days: highDays.map(d => d.day),
        });
      }

      // ── 4. Process Capability ──
      const USL = 100; // Upper spec = 100% yield
      const LSL = 85;  // Lower spec = 85% yield (quality target)
      const cp = stddev > 0 ? (USL - LSL) / (6 * stddev) : 0;
      const cpk = stddev > 0 ? Math.min((USL - mean) / (3 * stddev), (mean - LSL) / (3 * stddev)) : 0;
      const ppm = stddev > 0 ? Math.round(1000000 * (1 - normalCdf((USL - mean) / stddev) + normalCdf((LSL - mean) / stddev))) : 0;

      // ── 5. AI Insights ──
      const insights: { type: string; title: string; description: string; confidence: number; severity: 'info' | 'warning' | 'critical' }[] = [];

      // Trend detection (linear regression)
      const xVals = yields.map((_, i) => i);
      const xMean = (n - 1) / 2;
      const slopeNum = xVals.reduce((s, x, i) => s + (x - xMean) * (yields[i] - mean), 0);
      const slopeDen = xVals.reduce((s, x) => s + (x - xMean) ** 2, 0);
      const trendSlope = slopeDen > 0 ? slopeNum / slopeDen : 0;

      if (trendSlope < -0.5) {
        insights.push({
          type: 'trend', title: 'Downward yield trend detected',
          description: `Yield is declining at approximately ${Math.abs(trendSlope).toFixed(2)}% per day. At this rate, yield could drop below ${LSL}% within ${Math.ceil((mean - LSL) / Math.abs(trendSlope))} days.`,
          confidence: Math.min(0.95, 0.6 + Math.abs(trendSlope) * 0.1), severity: 'warning',
        });
      } else if (trendSlope > 0.3) {
        insights.push({
          type: 'trend', title: 'Positive yield trend',
          description: `Yield is improving at approximately ${trendSlope.toFixed(2)}% per day. Current trajectory suggests continued improvement.`,
          confidence: 0.7, severity: 'info',
        });
      }

      // Volatility analysis
      const cv = mean > 0 ? (stddev / mean) * 100 : 0;
      if (cv > 5) {
        insights.push({
          type: 'volatility', title: 'High process variability',
          description: `Coefficient of variation is ${cv.toFixed(1)}%. This indicates an unstable process that needs investigation.`,
          confidence: 0.85, severity: cv > 10 ? 'critical' : 'warning',
        });
      }

      // Periodicity detection (autocorrelation at lag 7 = weekly pattern)
      if (n >= 14) {
        const lag = 7;
        const autoCorr = xVals.slice(lag).reduce((s, _, i) => s + (yields[i + lag] - mean) * (yields[i] - mean), 0)
          / yields.reduce((s, y) => s + (y - mean) ** 2, 0);
        if (Math.abs(autoCorr) > 0.5) {
          insights.push({
            type: 'periodicity', title: 'Weekly pattern detected',
            description: `Strong ${autoCorr > 0 ? 'positive' : 'negative'} autocorrelation at 7-day lag (r=${autoCorr.toFixed(2)}). This suggests a recurring weekly cycle in yield.`,
            confidence: Math.min(0.9, 0.5 + Math.abs(autoCorr) * 0.4), severity: 'info',
          });
        }
      }

      // Anomaly summary
      if (anomalies.length > 0) {
        insights.push({
          type: 'anomaly', title: `${anomalies.length} anomalous day(s) detected`,
          description: `Modified Z-score analysis identified ${anomalies.length} days with unusual yield values. ${anomalies.filter(a => a.type === 'unusually_low').length} were unusually low.`,
          confidence: 0.9, severity: anomalies.some(a => a.type === 'unusually_low') ? 'warning' : 'info',
        });
      }

      // Capability assessment
      if (cpk < 1) {
        insights.push({
          type: 'capability', title: 'Process not capable',
          description: `Cpk = ${cpk.toFixed(2)} (target ≥ 1.33). The process cannot consistently meet the ${LSL}%-${USL}% specification. Estimated ${ppm} PPM defective.`,
          confidence: 0.95, severity: 'critical',
        });
      } else if (cpk < 1.33) {
        insights.push({
          type: 'capability', title: 'Marginal process capability',
          description: `Cpk = ${cpk.toFixed(2)} is below the 1.33 target. Process improvement is recommended to ensure consistent quality.`,
          confidence: 0.9, severity: 'warning',
        });
      }

      return {
        anomalies,
        forecast,
        clusters,
        insights,
        processCapability: {
          cp: Math.round(cp * 100) / 100,
          cpk: Math.round(cpk * 100) / 100,
          ppm,
          usl: USL,
          lsl: LSL,
          mean: Math.round(mean * 100) / 100,
          stddev: Math.round(stddev * 100) / 100,
        },
      };
    }),

  /**
   * Station Detail — inspection points with per-point defect stats,
   * measurements, positions, trend, and recent events for board-level visualisation.
   */
  getStationDetail: protectedProcedure
    .input(z.object({
      stationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      const machineIds = await getStationMachineIds(database, input.stationId);
      if (machineIds.length === 0) return { points: [], productImage: null, boardInfo: null };

      // Date filters for inspections
      const dateConds: SQL[] = [inArray(productInspections.machineId, machineIds)];
      if (input.startDate) dateConds.push(gte(productInspections.inspectionTime, input.startDate));
      if (input.endDate) dateConds.push(lte(productInspections.inspectionTime, input.endDate));

      // Get the product model for this station (most used product)
      const pmRows = await database.select({
        modelId: productInspections.productModelId,
        cnt: sql<number>`count(*)`.as('cnt'),
      })
        .from(productInspections)
        .where(and(...dateConds))
        .groupBy(productInspections.productModelId)
        .orderBy(desc(sql`cnt`))
        .limit(1);

      const primaryModelId = pmRows.length > 0 ? pmRows[0].modelId : null;

      // Fetch product model info (for reference image)
      let productImage: { url: string | null; width: number | null; height: number | null } | null = null;
      let boardInfo: { model: string; code: string } | null = null;
      if (primaryModelId) {
        const pm = await database.select({
          code: productModels.code,
          name: productModels.name,
          imageUrl: productModels.referenceImageUrl,
          imageWidth: productModels.imageWidth,
          imageHeight: productModels.imageHeight,
        }).from(productModels).where(eq(productModels.id, primaryModelId)).limit(1);
        if (pm.length > 0) {
          productImage = { url: pm[0].imageUrl, width: pm[0].imageWidth, height: pm[0].imageHeight };
          boardInfo = { model: pm[0].name, code: pm[0].code };
        }
      }

      // Fetch all active measurement point defs for machines in this station
      const pointDefs = await database.select()
        .from(measurementPointDefs)
        .where(and(
          inArray(measurementPointDefs.machineId, machineIds),
          eq(measurementPointDefs.isActive, true),
        ))
        .orderBy(asc(measurementPointDefs.orderIndex));

      // Also include points by product model if no machine-specific points found
      let allPointDefs = pointDefs;
      if (allPointDefs.length === 0 && primaryModelId) {
        allPointDefs = await database.select()
          .from(measurementPointDefs)
          .where(and(
            eq(measurementPointDefs.productModelId, primaryModelId),
            eq(measurementPointDefs.isActive, true),
          ))
          .orderBy(asc(measurementPointDefs.orderIndex));
      }

      if (allPointDefs.length === 0) return { points: [], productImage, boardInfo };

      const pointDefIds = allPointDefs.map(p => p.id);

      // Per-point statistics: total inspected, NG count
      const pointStats = await database.select({
        pointDefId: measurementResults.pointDefId,
        total: sql<number>`count(*)`.as('total'),
        ng: sql<number>`sum(case when ${measurementResults.result} = 'NG' then 1 else 0 end)`.as('ng'),
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(
          inArray(measurementResults.pointDefId, pointDefIds),
          ...dateConds,
        ))
        .groupBy(measurementResults.pointDefId);

      const statsMap = new Map(pointStats.map(s => [s.pointDefId, { total: Number(s.total), ng: Number(s.ng) }]));

      // Recent NG results per point (last 5 for events timeline)
      const recentNg = await database.select({
        pointDefId: measurementResults.pointDefId,
        result: measurementResults.result,
        measuredValue: measurementResults.measuredValue,
        measuredValueText: measurementResults.measuredValueText,
        inspectionTime: productInspections.inspectionTime,
        serialNumber: productInspections.serialNumber,
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(
          inArray(measurementResults.pointDefId, pointDefIds),
          ...dateConds,
        ))
        .orderBy(desc(productInspections.inspectionTime))
        .limit(200);

      // Group events per point (last 4 events each)
      const eventsMap = new Map<number, Array<{ time: string; result: string; value: string; serial: string }>>();
      for (const r of recentNg) {
        const arr = eventsMap.get(r.pointDefId) || [];
        if (arr.length < 4) {
          arr.push({
            time: r.inspectionTime ? new Date(r.inspectionTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--',
            result: r.result,
            value: r.measuredValueText || (r.measuredValue != null ? String(r.measuredValue) : '—'),
            serial: r.serialNumber || '',
          });
          eventsMap.set(r.pointDefId, arr);
        }
      }

      // Last measurement value per point (for current measurement display)
      const lastMeasurements = await database.select({
        pointDefId: measurementResults.pointDefId,
        measuredValue: measurementResults.measuredValue,
        measuredValueText: measurementResults.measuredValueText,
        result: measurementResults.result,
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(
          inArray(measurementResults.pointDefId, pointDefIds),
          ...dateConds,
        ))
        .orderBy(desc(productInspections.inspectionTime))
        .limit(pointDefIds.length);

      const lastMeasMap = new Map<number, { value: string; result: string }>();
      for (const m of lastMeasurements) {
        if (!lastMeasMap.has(m.pointDefId)) {
          lastMeasMap.set(m.pointDefId, {
            value: m.measuredValueText || (m.measuredValue != null ? String(m.measuredValue) : '—'),
            result: m.result,
          });
        }
      }

      // NG error images per point (recent 10 per point)
      const ngImages = await database.select({
        id: measurementResults.id,
        pointDefId: measurementResults.pointDefId,
        imageUrl: measurementResults.imageUrl,
        measuredValue: measurementResults.measuredValue,
        measuredValueText: measurementResults.measuredValueText,
        result: measurementResults.result,
        inspectionTime: productInspections.inspectionTime,
        serialNumber: productInspections.serialNumber,
      })
        .from(measurementResults)
        .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
        .where(and(
          inArray(measurementResults.pointDefId, pointDefIds),
          eq(measurementResults.result, 'NG'),
          isNotNull(measurementResults.imageUrl),
          ...dateConds,
        ))
        .orderBy(desc(productInspections.inspectionTime))
        .limit(pointDefIds.length * 10);

      const errorImagesMap = new Map<number, Array<{ id: number; imageUrl: string; measuredValue: string; result: string; inspectionTime: string; serialNumber: string }>>();
      for (const img of ngImages) {
        const arr = errorImagesMap.get(img.pointDefId) || [];
        if (arr.length < 10) {
          arr.push({
            id: img.id,
            imageUrl: img.imageUrl!,
            measuredValue: img.measuredValueText || (img.measuredValue != null ? String(img.measuredValue) : '—'),
            result: img.result,
            inspectionTime: img.inspectionTime ? new Date(img.inspectionTime).toISOString() : '',
            serialNumber: img.serialNumber || '',
          });
          errorImagesMap.set(img.pointDefId, arr);
        }
      }

      // Assemble points
      const points = allPointDefs.map(def => {
        const st = statsMap.get(def.id) || { total: 0, ng: 0 };
        const defectRate = st.total > 0 ? Math.round((st.ng / st.total) * 10000) / 100 : 0;
        const status: 'fail' | 'warn' | 'pass' = defectRate >= 2 ? 'fail' : defectRate >= 0.5 ? 'warn' : 'pass';
        const lastMeas = lastMeasMap.get(def.id);
        const events = eventsMap.get(def.id) || [];

        return {
          id: def.id,
          code: def.code,
          name: def.name,
          type: def.measurementType,
          positionX: def.positionX,
          positionY: def.positionY,
          radius: def.radius,
          cropWidth: def.cropWidth,
          cropHeight: def.cropHeight,
          status,
          defectRate,
          totalInspected: st.total,
          ngCount: st.ng,
          lowerLimit: def.lowerLimit ? Number(def.lowerLimit) : null,
          upperLimit: def.upperLimit ? Number(def.upperLimit) : null,
          nominalValue: def.nominalValue ? Number(def.nominalValue) : null,
          unit: def.unit,
          lastValue: lastMeas?.value ?? null,
          lastResult: lastMeas?.result ?? null,
          events,
          errorImages: errorImagesMap.get(def.id) || [],
        };
      });

      return { points, productImage, boardInfo };
    }),
});

/** Standard normal CDF approximation */
function normalCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}
async function getStationMachineIds(
  database: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  stationId: number,
): Promise<number[]> {
  const rows = await database.select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.stationId, stationId), eq(machines.isActive, true)));
  return rows.map(m => m.id);
}
