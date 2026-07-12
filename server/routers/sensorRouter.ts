/**
 * Doc 40 Wave 3A (MON-F2 companion) — Sensor telemetry read router.
 *
 * Exposes the REAL machine_sensor_readings stream (vibration / current /
 * temperature / …, ingested by sensorIngestService) for the maintenance
 * diagnosis surface (MachineCockpit "Telemetry" tab). This is the human-facing
 * mirror of the same table PdM now scores against (predictiveMaintenanceService
 * computeFailureRisk), closing the "no reader for sensor readings" gap.
 *
 *   listTypes  — which sensor types this machine has, with counts / freshness.
 *   readSeries — one sensor type over a window, downsampled, with a statistical
 *                reference band (mean ± 2σ) for the chart overlay.
 *
 * READ-ONLY. RBAC via protectedProcedure (same posture as predictiveMaintenanceRouter).
 * Honest degradation: no rows → empty series + null band (never fabricated values).
 */

import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db/connection";
import { machineSensorReadings } from "../../drizzle/schema";
import { sensorFeature, type SensorFeature } from "../services/predictiveMaintenanceService";

// ── Downsample: bucket rows into <= maxPoints buckets, avg/min/max per bucket. ──
interface SeriesPoint {
  t: number;      // epoch ms (bucket midpoint / raw timestamp)
  value: number;  // average within the bucket
  min: number;
  max: number;
  n: number;      // raw readings folded into this point
}

function downsample(
  rows: { t: number; value: number }[],
  maxPoints: number,
): SeriesPoint[] {
  if (rows.length === 0) return [];
  if (rows.length <= maxPoints) {
    return rows.map((r) => ({ t: r.t, value: r.value, min: r.value, max: r.value, n: 1 }));
  }
  const first = rows[0].t;
  const last = rows[rows.length - 1].t;
  const span = Math.max(1, last - first);
  const buckets = new Map<number, { sum: number; min: number; max: number; n: number; tSum: number }>();
  for (const r of rows) {
    const idx = Math.min(maxPoints - 1, Math.floor(((r.t - first) / span) * maxPoints));
    const b = buckets.get(idx);
    if (b) {
      b.sum += r.value; b.n += 1; b.tSum += r.t;
      if (r.value < b.min) b.min = r.value;
      if (r.value > b.max) b.max = r.value;
    } else {
      buckets.set(idx, { sum: r.value, min: r.value, max: r.value, n: 1, tSum: r.t });
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => ({
      t: Math.round(b.tSum / b.n),
      value: b.sum / b.n,
      min: b.min,
      max: b.max,
      n: b.n,
    }));
}

export const sensorRouter = router({
  /**
   * List the sensor types available for a machine over a window, with row count,
   * last reading time and a representative unit. Drives the type selector.
   */
  listTypes: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive(),
      windowHours: z.number().int().min(1).max(24 * 90).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { available: false as const, types: [] };

      const windowHours = input.windowHours ?? 24 * 7;
      const from = new Date(Date.now() - windowHours * 3600 * 1000);

      const rows = await db
        .select({
          sensorType: machineSensorReadings.sensorType,
          count: sql<number>`count(*)`,
          lastAt: sql<string>`max(${machineSensorReadings.timestamp})`,
          unit: sql<string | null>`max(${machineSensorReadings.unit})`,
        })
        .from(machineSensorReadings)
        .where(and(
          eq(machineSensorReadings.machineId, input.machineId),
          gte(machineSensorReadings.timestamp, from),
        ))
        .groupBy(machineSensorReadings.sensorType);

      const types = rows
        .map((r) => ({
          sensorType: r.sensorType,
          feature: sensorFeature(r.sensorType) as SensorFeature,
          count: Number(r.count),
          lastAt: r.lastAt ? new Date(r.lastAt).getTime() : null,
          unit: r.unit ?? null,
        }))
        .sort((a, b) => b.count - a.count);

      return { available: true as const, types };
    }),

  /**
   * Read one sensor type over a window, downsampled for charting, plus a
   * statistical reference band (mean ± 2σ) computed from the RAW rows. The band
   * is explicitly labelled "statistical" — the platform has no per-sensor
   * engineering limit table yet, so we never present a fabricated hard limit.
   */
  readSeries: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive(),
      sensorType: z.string().min(1).max(50),
      windowHours: z.number().int().min(1).max(24 * 90).optional(),
      maxPoints: z.number().int().min(50).max(5000).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const windowHours = input.windowHours ?? 24;
      const maxPoints = input.maxPoints ?? 500;
      const to = Date.now();
      const from = new Date(to - windowHours * 3600 * 1000);

      const empty = {
        available: false as const,
        machineId: input.machineId,
        sensorType: input.sensorType,
        feature: sensorFeature(input.sensorType) as SensorFeature,
        unit: null as string | null,
        windowHours,
        rawCount: 0,
        series: [] as SeriesPoint[],
        stats: null as null | { mean: number; std: number; min: number; max: number; count: number },
        referenceBand: null as null | { kind: "statistical"; mean: number; upper: number; lower: number },
      };

      if (!db) return empty;

      const rows = await db
        .select({
          value: machineSensorReadings.value,
          unit: machineSensorReadings.unit,
          timestamp: machineSensorReadings.timestamp,
        })
        .from(machineSensorReadings)
        .where(and(
          eq(machineSensorReadings.machineId, input.machineId),
          eq(machineSensorReadings.sensorType, input.sensorType),
          gte(machineSensorReadings.timestamp, from),
        ))
        .orderBy(machineSensorReadings.timestamp);

      if (rows.length === 0) return empty;

      const points = rows
        .map((r) => ({ t: new Date(r.timestamp).getTime(), value: Number(r.value) }))
        .filter((p) => Number.isFinite(p.value));

      if (points.length === 0) return empty;

      // Stats from RAW readings (not the downsampled buckets).
      const values = points.map((p) => p.value);
      const count = values.length;
      const mean = values.reduce((a, b) => a + b, 0) / count;
      const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / count;
      const std = Math.sqrt(variance);
      let min = values[0];
      let max = values[0];
      for (const v of values) { if (v < min) min = v; if (v > max) max = v; }

      // Representative unit: most recent non-null.
      let unit: string | null = null;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].unit != null) { unit = rows[i].unit; break; }
      }

      return {
        available: true as const,
        machineId: input.machineId,
        sensorType: input.sensorType,
        feature: sensorFeature(input.sensorType) as SensorFeature,
        unit,
        windowHours,
        rawCount: count,
        series: downsample(points, maxPoints),
        stats: { mean, std, min, max, count },
        // mean ± 2σ — an advisory statistical band, not an engineering limit.
        referenceBand: std > 0
          ? { kind: "statistical" as const, mean, upper: mean + 2 * std, lower: mean - 2 * std }
          : null,
      };
    }),
});
