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
import { idsMayTrongPhamVi, mayTrongPhamVi } from "./_adapterPhamVi";

export const predictiveMaintenanceRouter = router({
  getMachineRisk: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive(),
      windowHours: z.number().int().min(1).max(24 * 90).optional(),
    }))
    .query(async ({ input, ctx }) => {
      await mayTrongPhamVi(ctx, input.machineId); // phạm vi người dùng (L4 2026-10-25): máy ngoài phạm vi ≡ không tồn tại
      return computeFailureRisk(input.machineId, input.windowHours);
    }),

  getReliabilityStats: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive(),
      windowHours: z.number().int().min(1).max(24 * 90).optional(),
    }))
    .query(async ({ input, ctx }) => {
      await mayTrongPhamVi(ctx, input.machineId); // phạm vi người dùng (L4 2026-10-25)
      return computeReliabilityStats(input.machineId, input.windowHours);
    }),

  listRulForecast: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const idsMay = await idsMayTrongPhamVi(ctx); // phạm vi người dùng (L4 2026-10-25): chỉ máy trong phạm vi (lọc TRƯỚC khi cắt theo limit)
      const machines = (await getMachines()).filter((m: any) => idsMay === null || idsMay.includes(m.id));
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
              // ★ PH-39 — chuyền NGUYÊN VẸN xuất xứ của `failureRisk`; nếu không,
              //   người đọc danh sách này không phân biệt được "0 vì đã đo" với
              //   "0 vì chưa đo được gì". Xem `FailureRiskResult.riskMethod`.
              riskMethod: risk.riskMethod,
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
              // ★ PH-39 — nhánh này là một LỖI ĐỌC bị nuốt, không phải một phép
              //   đo ra 0. Nhãn phải nói đúng điều đó.
              riskMethod: "unavailable" as const,
            };
          }
        }),
      );
      return results.sort((a, b) => b.failureRisk - a.failureRisk);
    }),

  /**
   * G4.7 (doc 44 W5-B3) — latest PERSISTED survival RUL estimate for a machine.
   * Reads the rul_estimates table (written by the PdM cycle when
   * RUL_WEIBULL_ENABLED is on). Returns null when there is no persisted row yet
   * (flag off / cold start) — the live heuristic RUL is still on getMachineRisk.
   */
  getRulEstimate: protectedProcedure
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await mayTrongPhamVi(ctx, input.machineId); // phạm vi người dùng (L4 2026-10-25)
      const { getLatestRulEstimate } = await import("../services/ai/rulEstimatorService");
      return getLatestRulEstimate(input.machineId);
    }),

  runNow: adminProcedure
    .mutation(async () => {
      return runPredictiveMaintenanceCycle();
    }),
});
