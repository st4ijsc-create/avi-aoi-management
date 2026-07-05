/**
 * CPK Snapshot Scheduler — doc 31 Đợt E (OP9).
 *
 * `cpk_history` was only ever written by a MANUAL router call (spcAdvancedRouter
 * .cpkTrend.calculate), so in practice it stayed empty — starving the Cpk-trend
 * view and the auto-tune inputs that read it. This periodic job computes a
 * per-point capability snapshot over a trailing window and appends it to
 * cpk_history, mirroring the aiThresholdTuneScheduler lifecycle (node-cron, own
 * timer, flag-gated, fully error-isolated).
 *
 * Flag: CPK_SNAPSHOT_ENABLED (default OFF — like every other scheduler). Cron +
 * window are tunable via env. The computation reuses the SPC within-subgroup
 * path (I-MR sigma estimate + utils/spc.calculateCapabilityIndices), NOT the
 * advisor's percentile Cp/Cpk, so snapshots match the manual router numbers.
 */

import * as cron from "node-cron";
import {
  listPointDefsWithSpecLimits,
  getMeasurementValuesForSPC,
  saveCpkHistory,
} from "../db/spc";
import { calculateCapabilityIndices, mean, stdDev } from "../utils/spc";

// ─── Flags / constants ────────────────────────────────────────────────────────
const ENABLED = String(process.env.CPK_SNAPSHOT_ENABLED ?? "false").toLowerCase() === "true";
const CRON = process.env.CPK_SNAPSHOT_CRON || "30 4 * * *"; // 04:30 daily (after auto-tune 04:00)
const TZ = process.env.CPK_SNAPSHOT_TZ || "Asia/Ho_Chi_Minh";
const WINDOW_DAYS = Math.max(1, Number(process.env.CPK_SNAPSHOT_WINDOW_DAYS ?? 30));
const MIN_SAMPLES = Math.max(2, Number(process.env.CPK_SNAPSHOT_MIN_SAMPLES ?? 30));
const MAX_POINTS = Math.max(1, Number(process.env.CPK_SNAPSHOT_MAX_POINTS ?? 5000));
const VALUE_LIMIT = Math.max(100, Number(process.env.CPK_SNAPSHOT_VALUE_LIMIT ?? 50000));

// ─── Module state ─────────────────────────────────────────────────────────────
let job: cron.ScheduledTask | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastRunStats: CpkSnapshotStats | null = null;

export interface CpkSnapshotStats {
  points: number;    // capable points considered
  snapshotted: number; // rows written to cpk_history
  skippedThin: number; // points with < MIN_SAMPLES samples
  errors: number;
  windowDays: number;
  minSamples: number;
  ms: number;
}

/**
 * Within-subgroup sigma via the I-MR moving-range estimate (σ̂ = MR̄ / d₂, d₂=1.128
 * for n=2). Falls back to the overall stdDev when the moving range degenerates
 * (e.g. all-equal values). Matches the router's I-MR fallback path.
 */
function estimateWithinSigma(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumMr = 0;
  for (let i = 1; i < n; i++) sumMr += Math.abs(values[i] - values[i - 1]);
  const mrBar = sumMr / (n - 1);
  const sigma = mrBar / 1.128;
  if (sigma > 0) return sigma;
  return stdDev(values, mean(values));
}

/**
 * Compute + persist one Cpk snapshot per capable point. NOT gated by ENABLED
 * (ENABLED only controls cron registration) so it can be invoked on demand / in
 * tests. Never throws — every per-point failure is counted and isolated.
 */
export async function runCpkSnapshotNow(opts?: {
  windowDays?: number;
  minSamples?: number;
  now?: Date;
}): Promise<CpkSnapshotStats> {
  const t0 = Date.now();
  const windowDays = opts?.windowDays ?? WINDOW_DAYS;
  const minSamples = opts?.minSamples ?? MIN_SAMPLES;
  const endDate = opts?.now ?? new Date();
  const startDate = new Date(endDate.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const stats: CpkSnapshotStats = {
    points: 0,
    snapshotted: 0,
    skippedThin: 0,
    errors: 0,
    windowDays,
    minSamples,
    ms: 0,
  };

  let defs: Awaited<ReturnType<typeof listPointDefsWithSpecLimits>> = [];
  try {
    defs = await listPointDefsWithSpecLimits();
  } catch (e) {
    console.error("[cpkSnapshotScheduler] list capable points failed:", (e as any)?.message || e);
    stats.ms = Date.now() - t0;
    return stats;
  }

  for (const def of defs.slice(0, MAX_POINTS)) {
    stats.points++;
    try {
      const usl = Number(def.upperLimit);
      const lsl = Number(def.lowerLimit);
      if (!Number.isFinite(usl) || !Number.isFinite(lsl)) continue;
      const nominal = def.nominalValue != null ? Number(def.nominalValue) : undefined;

      // NOTE: only a lower bound (startDate) is applied. Ingest stores
      // "fake-UTC" shifted inspectionTimes (see processInspectionSubmission), so
      // an upper bound of real-now can wrongly exclude the freshest rows in a
      // positive-offset timezone. A trailing window only needs its lower bound.
      const rows = await getMeasurementValuesForSPC({
        measurementPointDefId: def.id,
        startDate,
        limit: VALUE_LIMIT,
      });
      const values: number[] = [];
      for (const r of rows) {
        const v = Number((r as any).value);
        if (Number.isFinite(v)) values.push(v);
      }
      if (values.length < minSamples) {
        stats.skippedThin++;
        continue;
      }

      const sigma = estimateWithinSigma(values);
      const idx = calculateCapabilityIndices(values, usl, lsl, sigma);

      await saveCpkHistory({
        measurementPointDefId: def.id,
        workstationId: def.workstationId ?? undefined,
        productModelId: def.productModelId,
        periodStart: startDate,
        periodEnd: endDate,
        sampleSize: values.length,
        mean: String(idx.mean),
        stdDev: String(idx.overallStdDev),
        cp: idx.cp != null ? String(idx.cp) : null,
        cpk: idx.cpk != null ? String(idx.cpk) : null,
        pp: idx.pp != null ? String(idx.pp) : null,
        ppk: idx.ppk != null ? String(idx.ppk) : null,
        cpl: idx.cpl != null ? String(idx.cpl) : null,
        cpu: idx.cpu != null ? String(idx.cpu) : null,
        usl: String(usl),
        lsl: String(lsl),
        nominal: nominal != null && Number.isFinite(nominal) ? String(nominal) : null,
      });
      stats.snapshotted++;
    } catch (e) {
      stats.errors++;
      console.error(`[cpkSnapshotScheduler] point ${def.id} snapshot failed:`, (e as any)?.message || e);
    }
  }

  stats.ms = Date.now() - t0;
  lastRunAt = new Date().toISOString();
  lastRunStats = stats;
  return stats;
}

// ─── Scheduler lifecycle (mirror aiThresholdTuneScheduler) ────────────────────

/** Register the cron job. No-op when CPK_SNAPSHOT_ENABLED is not "true". */
export function startCpkSnapshotScheduler(): void {
  if (!ENABLED) {
    console.log("[cpkSnapshotScheduler] disabled (set CPK_SNAPSHOT_ENABLED=true to enable)");
    return;
  }
  if (job) return; // already started
  job = cron.schedule(
    CRON,
    () => {
      if (running) return; // no overlap
      running = true;
      runCpkSnapshotNow()
        .then((s) => console.log(`[cpkSnapshotScheduler] snapshotted ${s.snapshotted}/${s.points} point(s), ${s.skippedThin} thin, ${s.errors} err in ${s.ms}ms`))
        .catch((e) => console.error("[cpkSnapshotScheduler] cron error:", e))
        .finally(() => { running = false; });
    },
    { timezone: TZ },
  );
  console.log(`[cpkSnapshotScheduler] scheduled '${CRON}' (${TZ}) window=${WINDOW_DAYS}d minSamples=${MIN_SAMPLES}`);
}

/** Stop the cron job (shutdown). Safe to call when not started. */
export function stopCpkSnapshotScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[cpkSnapshotScheduler] stopped");
  }
}

/** Status for dashboards / health. */
export function getCpkSnapshotSchedulerStatus() {
  return {
    enabled: ENABLED,
    cron: CRON,
    timezone: TZ,
    windowDays: WINDOW_DAYS,
    minSamples: MIN_SAMPLES,
    maxPoints: MAX_POINTS,
    running: !!job,
    lastRunAt,
    lastRunStats,
  };
}
