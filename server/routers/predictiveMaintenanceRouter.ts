/**
 * WS-4 — Predictive Maintenance Router
 *
 * getMachineRisk      — failure risk + confidence + timeframe + factors
 * getReliabilityStats — MTBF / MTTR / frequency / trend
 * listRulForecast     — per-machine RUL summary for active machines
 * runNow (admin)      — trigger one predictive cycle on demand
 *
 * License gating: the repo has no per-procedure license middleware
 * (see aiEvalRouter / aiTimeSeriesRouter — both use protected/admin only).
 * TODO(WS-4): wrap with a `licenseProcedure` once one exists.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import {
  computeFailureRisk,
  computeReliabilityStats,
  runPredictiveMaintenanceCycle,
} from "../services/predictiveMaintenanceService";
import { getMachines } from "../db/hierarchy";

export const predictiveMaintenanceRouter = router({
  getMachineRisk: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive(),
      windowHours: z.number().int().min(1).max(24 * 90).optional(),
    }))
    .query(async ({ input }) => {
      return computeFailureRisk(input.machineId, input.windowHours);
    }),

  getReliabilityStats: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive(),
      windowHours: z.number().int().min(1).max(24 * 90).optional(),
    }))
    .query(async ({ input }) => {
      return computeReliabilityStats(input.machineId, input.windowHours);
    }),

  listRulForecast: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ input }) => {
      const machines = await getMachines();
      const limited = machines.slice(0, input?.limit ?? 50);
      const results = await Promise.all(
        limited.map(async (m: any) => {
          try {
            const risk = await computeFailureRisk(m.id);
            return {
              machineId: m.id,
              machineCode: m.code,
              machineName: m.name,
              failureRisk: risk.failureRisk,
              confidenceScore: risk.confidenceScore,
              predictedTimeframe: risk.predictedTimeframe,
              predictedTimeframeHours: risk.predictedTimeframeHours,
              recommendedMaintenanceDate: risk.recommendedMaintenanceDate,
              maintenanceUrgency: risk.maintenanceUrgency,
              dataPoints: risk.dataPoints,
            };
          } catch {
            return {
              machineId: m.id,
              machineCode: m.code,
              machineName: m.name,
              failureRisk: 0,
              confidenceScore: 0,
              predictedTimeframe: null,
              predictedTimeframeHours: null,
              recommendedMaintenanceDate: null,
              maintenanceUrgency: "LOW" as const,
              dataPoints: 0,
            };
          }
        }),
      );
      return results.sort((a, b) => b.failureRisk - a.failureRisk);
    }),

  runNow: adminProcedure
    .mutation(async () => {
      return runPredictiveMaintenanceCycle();
    }),
});
