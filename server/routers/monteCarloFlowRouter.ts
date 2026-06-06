/**
 * P4.C G13 — Monte-Carlo Sankey tRPC router.
 *
 * Exposes a deterministic Monte-Carlo simulation of defect propagation
 * across the SMT line. Pure compute — no DB writes. Optional `useTraces`
 * mode estimates per-station inject/detect rates from the existing
 * `stationTraces` history.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { simulateLine, StationParams } from "../utils/monteCarloFlow";
import { STATION_ORDER } from "../utils/stationTriangulation";

const stationParamSchema = z.object({
  station: z.string().min(1),
  injectRate: z.number().min(0).max(1),
  detectRate: z.number().min(0).max(1),
  reworkRate: z.number().min(0).max(1).optional(),
});

function defaultParams(): StationParams[] {
  // Conservative defaults — caller normally overrides via `params`.
  return STATION_ORDER.map((s) => ({
    station: s,
    injectRate: 0.01,
    detectRate: 0.7,
    reworkRate: 0.85,
  }));
}

export const monteCarloFlowRouter = router({
  /** Run a Monte-Carlo simulation with caller-supplied parameters. */
  simulate: protectedProcedure
    .input(z.object({
      units: z.number().int().positive().max(200000).default(1000),
      params: z.array(stationParamSchema).optional(),
      seed: z.number().int().optional(),
      defaultReworkRate: z.number().min(0).max(1).optional(),
    }))
    .query(({ input }) => {
      const params = input.params && input.params.length > 0
        ? input.params
        : defaultParams();
      return simulateLine({
        units: input.units,
        params,
        seed: input.seed,
        defaultReworkRate: input.defaultReworkRate,
      });
    }),

  /**
   * Estimate per-station rates from `stationTraces` history (if present),
   * then run the simulation. Falls back to defaults when no trace data.
   */
  simulateFromHistory: protectedProcedure
    .input(z.object({
      units: z.number().int().positive().max(200000).default(1000),
      seed: z.number().int().optional(),
      lookbackDays: z.number().int().positive().max(365).default(30),
    }))
    .query(async ({ input }) => {
      const fromTs = new Date(Date.now() - input.lookbackDays * 24 * 60 * 60 * 1000);
      const params: StationParams[] = [];
      let usedHistory = false;
      for (const station of STATION_ORDER) {
        let injectRate = 0.01;
        let detectRate = 0.7;
        try {
          // Resolved dynamically to keep esbuild's namespace-import analysis
          // quiet when the optional helper is not present in `server/db`.
          const lister = (db as Record<string, any>)["listStationTraces"];
          if (typeof lister === "function") {
            const rows = await lister({ stationCode: station, fromTs, limit: 5000 });
            if (Array.isArray(rows) && rows.length > 0) {
              usedHistory = true;
              let total = 0, defects = 0, detected = 0;
              for (const r of rows) {
                total++;
                const isDefect = (r.isDefect ?? r.is_defect ?? r.defect) === true;
                const isDetected = (r.detected ?? r.isDetected) === true;
                if (isDefect) defects++;
                if (isDefect && isDetected) detected++;
              }
              injectRate = total > 0 ? defects / total : injectRate;
              detectRate = defects > 0 ? detected / defects : detectRate;
            }
          }
        } catch {
          // Swallow — fall back to defaults for this station.
        }
        params.push({ station, injectRate, detectRate, reworkRate: 0.85 });
      }
      const result = simulateLine({
        units: input.units,
        params,
        seed: input.seed,
      });
      return { ...result, usedHistory, params };
    }),
});
