/**
 * Sprint G2.6a — Advanced energy analytics tRPC router.
 *
 * SAFETY: every procedure is read-only analytics or energy TELEMETRY. NOTHING
 * here writes a command to a machine (no commandDispatcher / driver.writeTags).
 *   - recipeEnergy / peakDemand / powerFactor / forecast / enpi : read (canView)
 *   - recordReading : writes a DATA row to energy_readings (canCreate) — telemetry,
 *                     NOT a control command. Also mirrors to TimescaleDB when enabled.
 *   - snapshotEnpi  : idempotent EnPI snapshot upsert (canEdit).
 *   - demandResponse: returns TEXT + i18n keys ONLY (advisory; performs no action).
 *
 * RBAC: module "energy" (canView/Create/Edit) via requirePermission.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import * as db from "../db";
import { insertEnergyReading, isTsdbEnabled } from "../db/timescale";
import {
  computeRecipeEnergy,
  computePeakDemand,
  computePowerFactor,
  forecastEnergy,
  suggestDemandResponse,
} from "../services/energyAnalyticsService";

const MODULE = "energy";

const rangeInput = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  machineId: z.number().int().positive().optional(),
});

export const energyRouter = router({
  // ─── Per-recipe energy (read) ─────────────────────────────────────────────
  recipeEnergy: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(rangeInput)
    .query(({ input }) => computeRecipeEnergy(input)),

  // ─── Peak demand (read) ───────────────────────────────────────────────────
  peakDemand: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(rangeInput.extend({ windowMin: z.number().int().positive().max(1440).optional() }))
    .query(({ input }) => computePeakDemand(input)),

  // ─── Power factor (read) ──────────────────────────────────────────────────
  powerFactor: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(rangeInput.extend({ threshold: z.number().min(0).max(1).optional() }))
    .query(({ input }) => computePowerFactor(input)),

  // ─── Forecast (read) ──────────────────────────────────────────────────────
  forecast: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(rangeInput.extend({
      metric: z.enum(["kwh", "powerKw"]).optional(),
      horizon: z.number().int().positive().max(168).optional(),
      algorithm: z.enum(["ewma", "holt_winters"]).optional(),
      bucketMin: z.number().int().positive().max(1440).optional(),
    }))
    .query(({ input }) => forecastEnergy(input)),

  // ─── Demand-response advisory (read; TEXT ONLY — no action) ────────────────
  demandResponse: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(rangeInput.extend({
      thresholdKw: z.number().positive(),
      windowMin: z.number().int().positive().max(1440).optional(),
      horizon: z.number().int().positive().max(168).optional(),
    }))
    .query(async ({ input }) => {
      const [peak, forecast] = await Promise.all([
        computePeakDemand({ from: input.from, to: input.to, machineId: input.machineId, windowMin: input.windowMin }),
        forecastEnergy({ from: input.from, to: input.to, machineId: input.machineId, metric: "powerKw", horizon: input.horizon }),
      ]);
      return { suggestions: suggestDemandResponse(forecast, peak, input.thresholdKw), peak, forecast };
    }),

  // ─── EnPI list (read) ─────────────────────────────────────────────────────
  enpi: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      recipeId: z.number().int().positive().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }))
    .query(({ input }) => db.listEnpiMetrics(input)),

  // ─── Record an energy reading (TELEMETRY — canCreate, NOT a machine write) ─
  recordReading: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      layoutId: z.number().int().positive().optional(),
      source: z.enum(["electricity", "compressed_air", "water", "gas", "steam", "other"]).optional(),
      value: z.number().nonnegative(),
      unit: z.string().max(16).optional(),
      powerKw: z.number().optional(),
      reactivePowerKvar: z.number().optional(),
      apparentPowerKva: z.number().optional(),
      powerFactor: z.number().min(0).max(1).optional(), // PF ∈ [0,1]
      recipeRef: z.string().max(128).optional(),
      timestamp: z.coerce.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const row = {
        machineId: input.machineId ?? null,
        layoutId: input.layoutId ?? null,
        source: input.source ?? "electricity",
        value: String(input.value),
        unit: input.unit ?? "kWh",
        powerKw: input.powerKw != null ? String(input.powerKw) : null,
        reactivePowerKvar: input.reactivePowerKvar != null ? String(input.reactivePowerKvar) : null,
        apparentPowerKva: input.apparentPowerKva != null ? String(input.apparentPowerKva) : null,
        powerFactor: input.powerFactor != null ? String(input.powerFactor) : null,
        recipeRef: input.recipeRef ?? null,
        ...(input.timestamp ? { timestamp: input.timestamp } : {}),
      };
      const id = await db.recordEnergyReading(row);
      // Mirror to TimescaleDB hypertable when enabled (no-op otherwise).
      const mirroredToTsdb = isTsdbEnabled() ? await insertEnergyReading(row) : false;
      return { id, mirroredToTsdb };
    }),

  // ─── EnPI snapshot (idempotent on period + recipe + machine — canEdit) ─────
  snapshotEnpi: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      layoutId: z.number().int().positive().optional(),
      from: z.coerce.date(),
      to: z.coerce.date(),
      recipeId: z.number().int().positive().optional(),
      recipeCode: z.string().max(64).optional(),
      carbonKg: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const range = { from: input.from, to: input.to, machineId: input.machineId };
      const [recipeRows, peak, pf] = await Promise.all([
        computeRecipeEnergy(range),
        computePeakDemand(range),
        computePowerFactor(range),
      ]);

      // Aggregate kWh + good units across attributed recipes for the period.
      const totalKwh = recipeRows.reduce((s, r) => s + r.totalKwh, 0);
      const goodUnits = recipeRows.reduce((s, r) => s + r.unitsProduced, 0);
      const energyPerUnit = goodUnits > 0 ? totalKwh / goodUnits : null;

      return db.upsertEnpiSnapshot({
        machineId: input.machineId ?? null,
        layoutId: input.layoutId ?? null,
        periodStart: input.from,
        periodEnd: input.to,
        totalKwh,
        goodUnits,
        energyPerUnit,
        peakDemandKw: peak.rollingDemandKw ?? peak.instantaneousPeakKw ?? null,
        avgPowerFactor: pf.available ? pf.avgPowerFactor : null,
        recipeId: input.recipeId ?? null,
        recipeCode: input.recipeCode ?? null,
        carbonKg: input.carbonKg ?? null,
      });
    }),
});
