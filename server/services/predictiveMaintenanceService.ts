/**
 * WS-4 — Predictive Maintenance Service
 *
 * Offline-first, heuristic + statistical. Reuses the existing time-series engine
 * (aiTimeSeriesEngine.ts) and OEE state durations (oeeService.ts). NO heavy ML.
 * GGUF is used only for non-blocking interpretation (catch -> null).
 *
 * Failure-risk model (hybrid, no training):
 *   failureRisk (0-100) = weighted blend of
 *     - riskReliability : hazard = uptimeSinceLast / MTBF
 *     - riskTrend       : slope of healthScore (declining health -> higher risk)
 *     - riskAnomaly     : share of anomalous heartbeat points (Isolation Forest)
 *     - riskTemp        : temperature change-point detected (CUSUM)
 *   predictedTimeframe  = first horizon where lower-CI of forecast healthScore
 *                         crosses the danger threshold (capped by MTBF)
 *   confidenceScore     = f(dataPoints, CI width, number of agreeing features)
 *
 * Cold-start: sparse data -> low confidence -> no alert below threshold.
 */

import { getDb } from "../db/connection";
import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import {
  machineHeartbeats,
  machineHealthHistory,
  machineSensorReadings,
  downtimeEvents,
  machines,
} from "../../drizzle/schema";
import { computeStateDurations } from "./oeeService";
import {
  ewmaForecast,
  detectChangePoints,
  analyzeMultivariate,
  type TimeSeriesPoint,
  type MultivariatePoint,
} from "./aiTimeSeriesEngine";
import { recordMachineHealthSnapshot } from "../db/machine";

// ─── Tunables (env-overridable) ──────────────────────────────────────────────

const DANGER_HEALTH_THRESHOLD = 40; // healthScore below this = danger zone
const RISK_ALERT_THRESHOLD = Number(process.env.PM_RISK_THRESHOLD ?? 60); // 0-100
const CONFIDENCE_ALERT_THRESHOLD = Number(process.env.PM_CONFIDENCE_THRESHOLD ?? 50); // 0-100
/**
 * G4.9 (doc 44 W0-F) — alert lead-time gate. Default was 24h, which silently
 * suppressed every prediction whose ETA was 1–7 days out (exactly the window a
 * planner needs to schedule maintenance). Default is now 168h (1 week); the env
 * override keeps the same name. HONEST: the "RUL" behind this gate is still a
 * heuristic proxy (EWMA health-forecast crossing + MTBF cap), NOT a trained
 * survival/RUL model — treat the timeframe as a planning hint, not a guarantee.
 */
const TIMEFRAME_ALERT_HOURS = Number(process.env.PM_TIMEFRAME_HOURS ?? 168); // alert if failure <= X hours
const MIN_HEALTH_POINTS = 5; // below this, trend/forecast are unreliable
/** Upper bound on forecast steps so a dense series can't explode the EWMA loop. */
const MAX_FORECAST_STEPS = 720;

// Feature weights (sum need not be 1; we normalize by sum of active weights)
const W_RELIABILITY = 0.35;
const W_TREND = 0.30;
const W_ANOMALY = 0.20;
const W_TEMP = 0.15;

/**
 * calculationMethod tag this service writes onto its own health snapshots.
 * MON-F15: the risk-trend feature must NOT eat these PdM-written rows (that would
 * be self-referential — PdM predicting on its own predictions). The trend feature
 * only consumes MEASURED health (calculationMethod != PDM_CALC_METHOD, i.e. the
 * 'WEIGHTED' snapshots derived from real OEE / error-rate / cycle-time).
 */
export const PDM_CALC_METHOD = "PREDICTIVE_WS4";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReliabilityStats {
  machineId: number;
  windowHours: number;
  unplannedEvents: number;     // count of UD events
  totalUnplannedMinutes: number;
  uptimeMinutes: number;       // productive + standby + engineering uptime
  mtbfHours: number | null;    // uptime / unplanned events
  mttrHours: number | null;    // total UD minutes / unplanned events
  failuresPerDay: number;      // frequency
  trend: "increasing" | "decreasing" | "stable"; // failure-frequency trend
}

export interface RiskFactor {
  name: string;
  contribution: number; // 0-100, this factor's own risk
  description: string;
}

export interface FailureRiskResult {
  machineId: number;
  failureRisk: number;        // 0-100
  confidenceScore: number;    // 0-100
  predictedTimeframe: string | null; // e.g. "within 18 hours"
  predictedTimeframeHours: number | null;
  recommendedMaintenanceDate: Date | null;
  maintenanceUrgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  factors: RiskFactor[];
  dataPoints: number;
}

/** Raw inputs for pure risk computation — enables unit testing without a DB. */
export interface RiskInputs {
  machineId: number;
  reliability: ReliabilityStats | null;
  /** healthScore series, oldest -> newest, with epoch-ms timestamps. */
  healthSeries: TimeSeriesPoint[];
  /** heartbeat metrics for anomaly detection (cpu/mem/disk/temperature). */
  heartbeatSeries: MultivariatePoint[];
  /** temperature-only series for change-point detection. */
  tempSeries: TimeSeriesPoint[];
  /** uptime (hours) since the last unplanned-downtime event. */
  uptimeSinceLastHours: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function urgencyFromRisk(risk: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (risk >= 75) return "CRITICAL";
  if (risk >= 55) return "HIGH";
  if (risk >= 35) return "MEDIUM";
  return "LOW";
}

function describeTimeframe(hours: number | null): string | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours <= 24) return `within ${Math.max(1, Math.round(hours))} hours`;
  const days = Math.round(hours / 24);
  return `within ${days} day${days > 1 ? "s" : ""}`;
}

// ─── MON-F2: machine_sensor_readings → PdM feature mapping ────────────────────
// machine_sensor_readings carries the REAL telemetry (vibration / current /
// temperature / torque, ingested via sensorIngestService). machine_heartbeats has
// no writer, so PdM's anomaly + temperature features used to be dead. Map:
//   vibration, current, torque → multivariate anomaly (Isolation Forest)
//   temperature                → CUSUM change-point series

export type SensorFeature = "vibration" | "current" | "temperature" | "torque" | "other";

/** Classify a raw sensorType string into a PdM feature (tolerant of synonyms). */
export function sensorFeature(sensorType: string): SensorFeature {
  const s = (sensorType ?? "").toLowerCase();
  if (s.includes("vib")) return "vibration";
  // G4.10 (doc 44 W0-F): torque/mô-men used to fall into "other" and was DROPPED.
  // Checked BEFORE "current" because "motor torque" would otherwise match "motor".
  if (s.includes("torq") || s.includes("moment") || s.includes("momen") || s.includes("mô-men")) return "torque";
  if (s.includes("current") || s.includes("amp") || s.includes("motor")) return "current";
  if (s.includes("temp")) return "temperature";
  return "other";
}

export interface SensorReadingPoint {
  sensorType: string;
  value: number;
  timestamp: number; // epoch ms
}

/**
 * Build PdM feature series from raw machine_sensor_readings rows.
 *  - `multivariate`: forward-filled {vibration, current, torque} vectors for anomaly share.
 *    Only sensor types that actually have data become dimensions (honest — no
 *    fabricated zeros for absent sensors). Points are emitted only once every
 *    present dimension has at least one observation.
 *  - `tempSeries`: temperature readings for CUSUM change-point detection.
 */
export function buildSensorFeatureSeries(rows: SensorReadingPoint[]): {
  multivariate: MultivariatePoint[];
  tempSeries: TimeSeriesPoint[];
} {
  const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);

  const tempSeries: TimeSeriesPoint[] = sorted
    .filter((r) => sensorFeature(r.sensorType) === "temperature")
    .map((r) => ({ timestamp: r.timestamp, value: r.value }));

  // Which anomaly dimensions are present at all? (torque is consumed exactly like
  // current — an extra Isolation-Forest dimension when the sensor stream has it.)
  const present = new Set<Exclude<SensorFeature, "temperature" | "other">>();
  for (const r of sorted) {
    const f = sensorFeature(r.sensorType);
    if (f === "vibration" || f === "current" || f === "torque") present.add(f);
  }
  const dims = [...present];

  const multivariate: MultivariatePoint[] = [];
  if (dims.length > 0) {
    const last: Record<string, number> = {};
    for (const r of sorted) {
      const f = sensorFeature(r.sensorType);
      if (f !== "vibration" && f !== "current" && f !== "torque") continue;
      last[f] = r.value;
      // Emit only after every present dimension has at least one observation,
      // so early points aren't forward-filled from nothing.
      if (dims.every((d) => last[d] != null)) {
        const values: Record<string, number> = {};
        for (const d of dims) values[d] = last[d];
        multivariate.push({ timestamp: r.timestamp, values });
      }
    }
  }

  return { multivariate, tempSeries };
}

// ─── Reliability statistics (MTBF / MTTR / frequency / trend) ────────────────

/**
 * Compute reliability stats over a window. UD = unscheduled downtime
 * (category unplanned/breakdown/failure/fault), classified via oeeService.
 *
 * MTBF = uptime / #UD events ; MTTR = total UD minutes / #UD events.
 */
export async function computeReliabilityStats(
  machineId: number,
  windowHours = 24 * 30,
): Promise<ReliabilityStats> {
  const to = new Date();
  const from = new Date(to.getTime() - windowHours * 3600 * 1000);

  const empty: ReliabilityStats = {
    machineId,
    windowHours,
    unplannedEvents: 0,
    totalUnplannedMinutes: 0,
    uptimeMinutes: 0,
    mtbfHours: null,
    mttrHours: null,
    failuresPerDay: 0,
    trend: "stable",
  };

  const db = await getDb();
  if (!db) return empty;

  // SEMI-E10 state durations (UD = unscheduled downtime in minutes)
  const states = await computeStateDurations({ machineId, from, to });

  // Count discrete UD events + per-half frequency trend
  const events = await db
    .select({
      category: downtimeEvents.category,
      startTime: downtimeEvents.startTime,
      endTime: downtimeEvents.endTime,
      duration: downtimeEvents.duration,
    })
    .from(downtimeEvents)
    .where(and(
      eq(downtimeEvents.machineId, machineId),
      gte(downtimeEvents.startTime, from),
      lte(downtimeEvents.startTime, to),
    ));

  const UD_CATEGORIES = new Set(["unplanned", "breakdown", "failure", "fault"]);
  const udEvents = events.filter((e) => UD_CATEGORIES.has(String(e.category).toLowerCase()));
  const unplannedEvents = udEvents.length;

  const totalUnplannedMinutes = states.UD;
  const uptimeMinutes = states.equipmentUptime; // PT + SB + ET + UD

  let mtbfHours = unplannedEvents > 0 ? uptimeMinutes / unplannedEvents / 60 : null;
  let mttrHours = unplannedEvents > 0 ? totalUnplannedMinutes / unplannedEvents / 60 : null;
  const failuresPerDay = unplannedEvents / Math.max(1, windowHours / 24);

  // ── W4-A (doc 35 §W4.2) — UNIFY MTTR/MTBF ──────────────────────────────────
  // Historically this service derived MTTR/MTBF from downtimeEvents while the MES
  // Control Tower derived them from COMPLETED maintenance_work_orders
  // (pdmWorkOrderService.computeMttrMtbf) — the two UIs showed divergent numbers.
  // The work-order source is authoritative (openedAt/repairStartedAt/closedAt are
  // precise repair spans), so we DELEGATE these two fields to it when work orders
  // exist for the window. Everything else (event counts / uptime / trend /
  // frequency) still comes from the SEMI-E10 downtime view. Fail-safe: on any
  // error we keep the event-derived numbers. Return shape is unchanged.
  try {
    const { computeMttrMtbf } = await import("./pdmWorkOrderService");
    const wo = await computeMttrMtbf(machineId, from, to);
    if (wo.failureCount > 0) {
      if (wo.mtbfHours != null) mtbfHours = wo.mtbfHours;
      if (wo.mttrMinutes != null) mttrHours = wo.mttrMinutes / 60;
    }
  } catch {
    /* keep downtime-event-derived MTTR/MTBF as fallback */
  }

  // Failure-frequency trend: compare first vs second half of window
  const mid = from.getTime() + (to.getTime() - from.getTime()) / 2;
  const firstHalf = udEvents.filter((e) => new Date(e.startTime).getTime() < mid).length;
  const secondHalf = unplannedEvents - firstHalf;
  let trend: ReliabilityStats["trend"] = "stable";
  if (secondHalf > firstHalf + 1) trend = "increasing";
  else if (firstHalf > secondHalf + 1) trend = "decreasing";

  return {
    machineId,
    windowHours,
    unplannedEvents,
    totalUnplannedMinutes,
    uptimeMinutes,
    mtbfHours,
    mttrHours,
    failuresPerDay,
    trend,
  };
}

/**
 * W4-A (doc 35) — public alias. `getReliabilityStats` is the intent-revealing
 * name for the unified reliability read; it delegates to computeReliabilityStats
 * (whose MTTR/MTBF now come from the authoritative work-order source, so this and
 * the MES Control Tower's reliability read agree). New call sites should prefer
 * this name; computeReliabilityStats is kept for existing callers.
 */
export const getReliabilityStats = computeReliabilityStats;

// ─── Pure risk computation (testable, no DB) ─────────────────────────────────

/**
 * Compute failure risk from already-gathered inputs. Pure & deterministic
 * (the time-series engine's Isolation Forest is stochastic but bounded; anomaly
 * SHARE is stable for clearly anomalous vs. normal series).
 */
export function computeFailureRiskFromInputs(inputs: RiskInputs): FailureRiskResult {
  const { machineId, reliability, healthSeries, heartbeatSeries, tempSeries, uptimeSinceLastHours } = inputs;
  const factors: RiskFactor[] = [];

  let weightSum = 0;
  let weightedRisk = 0;
  let agreeingFeatures = 0; // features with elevated (>50) risk

  // 1) Reliability hazard: uptimeSinceLast / MTBF. Ratio>=1 means overdue.
  let riskReliability = 0;
  if (reliability?.mtbfHours && reliability.mtbfHours > 0 && uptimeSinceLastHours != null) {
    const hazard = uptimeSinceLastHours / reliability.mtbfHours;
    riskReliability = clamp(hazard * 60); // hazard 1.0 -> 60, 1.67 -> 100
    if (reliability.trend === "increasing") riskReliability = clamp(riskReliability + 15);
    weightedRisk += riskReliability * W_RELIABILITY;
    weightSum += W_RELIABILITY;
    if (riskReliability > 50) agreeingFeatures++;
    factors.push({
      name: "reliability",
      contribution: Math.round(riskReliability),
      description: `Hazard ${(hazard).toFixed(2)} (uptime ${uptimeSinceLastHours.toFixed(1)}h vs MTBF ${reliability.mtbfHours.toFixed(1)}h)` +
        (reliability.trend === "increasing" ? ", failure frequency rising" : ""),
    });
  }

  // 2) Health trend: slope of healthScore. Declining health -> higher risk.
  let riskTrend = 0;
  let timeframeHours: number | null = null;
  if (healthSeries.length >= MIN_HEALTH_POINTS) {
    // G4.9 (doc 44 W0-F): widen the forecast horizon to cover the (now 168h)
    // alert lead-time. Horizon is in STEPS of the series' average interval, so a
    // fixed 48 steps of hourly snapshots could only ever "see" ~2 days ahead —
    // predictions 3–7 days out were structurally impossible. Steps are derived
    // from the interval so the forecast reaches TIMEFRAME_ALERT_HOURS (bounded).
    const avgIntervalMs = healthSeries.length > 1
      ? (healthSeries[healthSeries.length - 1].timestamp - healthSeries[0].timestamp) / (healthSeries.length - 1)
      : 3600_000;
    const horizonSteps = Math.min(
      MAX_FORECAST_STEPS,
      Math.max(48, Math.ceil((TIMEFRAME_ALERT_HOURS * 3600_000) / Math.max(1, avgIntervalMs))),
    );
    const forecast = ewmaForecast(healthSeries, 0.3, horizonSteps);
    const last = healthSeries[healthSeries.length - 1].value;
    const first = healthSeries[0].value;
    const slope = (last - first) / Math.max(1, healthSeries.length - 1); // per step
    // Declining (negative slope) raises risk. Scale: -2/step ~ strong decline.
    riskTrend = clamp((-slope) * 30 + (last < DANGER_HEALTH_THRESHOLD ? 30 : 0));
    weightedRisk += riskTrend * W_TREND;
    weightSum += W_TREND;
    if (riskTrend > 50) agreeingFeatures++;

    // "RUL" (heuristic proxy — NOT a trained survival model): first forecast
    // horizon whose lower-CI crosses the danger threshold.
    for (const fp of forecast) {
      if (fp.lower <= DANGER_HEALTH_THRESHOLD) {
        timeframeHours = Math.max(0, (fp.timestamp - healthSeries[healthSeries.length - 1].timestamp) / 3600_000);
        break;
      }
    }
    // Cap timeframe by MTBF if available
    if (timeframeHours != null && reliability?.mtbfHours) {
      timeframeHours = Math.min(timeframeHours, reliability.mtbfHours);
    }
    factors.push({
      name: "trend",
      contribution: Math.round(riskTrend),
      description: `Health slope ${slope.toFixed(2)}/step, latest ${Math.round(last)}` +
        (timeframeHours != null ? `, projected danger in ~${timeframeHours.toFixed(0)}h` : ""),
    });
  }

  // 3) Anomaly share from multivariate heartbeats (Isolation Forest).
  let riskAnomaly = 0;
  if (heartbeatSeries.length >= 8) {
    const anomalies = analyzeMultivariate(heartbeatSeries, { threshold: 0.62 });
    const share = anomalies.length / heartbeatSeries.length;
    riskAnomaly = clamp(share * 250); // 8% anomalies -> 20, 40% -> 100
    weightedRisk += riskAnomaly * W_ANOMALY;
    weightSum += W_ANOMALY;
    if (riskAnomaly > 50) agreeingFeatures++;
    factors.push({
      name: "anomaly",
      contribution: Math.round(riskAnomaly),
      description: `${anomalies.length}/${heartbeatSeries.length} telemetry points anomalous (${(share * 100).toFixed(1)}%)`,
    });
  }

  // 4) Temperature change-point (CUSUM). An upward shift raises risk.
  let riskTemp = 0;
  if (tempSeries.length >= 10) {
    const cps = detectChangePoints(tempSeries, 4.0);
    const upShifts = cps.filter((c) => c.direction === "increase").length;
    riskTemp = clamp(upShifts > 0 ? 60 + upShifts * 15 : 0);
    weightedRisk += riskTemp * W_TEMP;
    weightSum += W_TEMP;
    if (riskTemp > 50) agreeingFeatures++;
    factors.push({
      name: "temperature",
      contribution: Math.round(riskTemp),
      description: upShifts > 0
        ? `${upShifts} upward temperature change-point(s) detected`
        : "Temperature stable",
    });
  }

  const failureRisk = weightSum > 0 ? clamp(weightedRisk / weightSum) : 0;

  // Confidence: more data, more agreeing features, narrower CI -> higher.
  const dataPoints = healthSeries.length + heartbeatSeries.length + (reliability?.unplannedEvents ?? 0);
  const dataComponent = clamp((Math.min(dataPoints, 100) / 100) * 50); // up to 50
  const agreementComponent = clamp((agreeingFeatures / 4) * 30); // up to 30
  let ciComponent = 0;
  if (healthSeries.length >= MIN_HEALTH_POINTS) {
    const fc = ewmaForecast(healthSeries, 0.3, 12);
    if (fc.length > 0) {
      const widths = fc.map((p) => Math.abs(p.upper - p.lower));
      const avgWidth = widths.reduce((a, b) => a + b, 0) / widths.length;
      // narrower band (relative to 0-100 scale) -> higher confidence, up to 20
      ciComponent = clamp(20 * (1 - Math.min(1, avgWidth / 100)));
    }
  }
  const confidenceScore = clamp(dataComponent + agreementComponent + ciComponent);

  // If trend gave no timeframe but reliability is overdue, fall back to MTBF horizon.
  if (timeframeHours == null && riskReliability >= 60 && reliability?.mtbfHours && uptimeSinceLastHours != null) {
    timeframeHours = Math.max(0, reliability.mtbfHours - uptimeSinceLastHours);
  }

  const recommendedMaintenanceDate = timeframeHours != null
    ? new Date(Date.now() + timeframeHours * 3600_000)
    : null;

  return {
    machineId,
    failureRisk: Math.round(failureRisk),
    confidenceScore: Math.round(confidenceScore),
    predictedTimeframe: describeTimeframe(timeframeHours),
    predictedTimeframeHours: timeframeHours != null ? Math.round(timeframeHours) : null,
    recommendedMaintenanceDate,
    maintenanceUrgency: urgencyFromRisk(failureRisk),
    factors,
    dataPoints,
  };
}

// ─── DB-backed risk computation ──────────────────────────────────────────────

export async function computeFailureRisk(
  machineId: number,
  windowHours = 24 * 14,
): Promise<FailureRiskResult> {
  const db = await getDb();
  if (!db) {
    return {
      machineId,
      failureRisk: 0,
      confidenceScore: 0,
      predictedTimeframe: null,
      predictedTimeframeHours: null,
      recommendedMaintenanceDate: null,
      maintenanceUrgency: "LOW",
      factors: [],
      dataPoints: 0,
    };
  }

  const to = new Date();
  const from = new Date(to.getTime() - windowHours * 3600 * 1000);

  const reliability = await computeReliabilityStats(machineId, windowHours);

  // Health score series (oldest -> newest).
  // MON-F15: consume only MEASURED health — exclude this service's OWN snapshots
  // (calculationMethod = PDM_CALC_METHOD) so the trend feature isn't fed by its
  // own predictions. What remains are the 'WEIGHTED' snapshots derived from real
  // OEE / error-rate / cycle-time.
  const healthRows = await db
    .select({
      timestamp: machineHealthHistory.timestamp,
      healthScore: machineHealthHistory.healthScore,
    })
    .from(machineHealthHistory)
    .where(and(
      eq(machineHealthHistory.machineId, machineId),
      gte(machineHealthHistory.timestamp, from),
      ne(machineHealthHistory.calculationMethod, PDM_CALC_METHOD),
    ))
    .orderBy(machineHealthHistory.timestamp);

  const healthSeries: TimeSeriesPoint[] = healthRows.map((r) => ({
    timestamp: new Date(r.timestamp).getTime(),
    value: Number(r.healthScore),
  }));

  // MON-F2: anomaly + temperature features come from the REAL sensor stream
  // (machine_sensor_readings). vibration/current → multivariate anomaly,
  // temperature → CUSUM. machine_heartbeats has no writer, so it is used only as
  // a fallback (keeps a future heartbeat writer contributing without a code change).
  const sensorRows = await db
    .select({
      sensorType: machineSensorReadings.sensorType,
      value: machineSensorReadings.value,
      timestamp: machineSensorReadings.timestamp,
    })
    .from(machineSensorReadings)
    .where(and(
      eq(machineSensorReadings.machineId, machineId),
      gte(machineSensorReadings.timestamp, from),
    ))
    .orderBy(machineSensorReadings.timestamp);

  const sensorFeatures = buildSensorFeatureSeries(
    sensorRows.map((r) => ({
      sensorType: r.sensorType,
      value: Number(r.value),
      timestamp: new Date(r.timestamp).getTime(),
    })),
  );

  let heartbeatSeries: MultivariatePoint[];
  let tempSeries: TimeSeriesPoint[];

  if (sensorFeatures.multivariate.length > 0 || sensorFeatures.tempSeries.length > 0) {
    // Real sensor telemetry present → use it.
    heartbeatSeries = sensorFeatures.multivariate;
    tempSeries = sensorFeatures.tempSeries;
  } else {
    // Fallback: legacy heartbeat metrics (cpu/mem/disk/temperature).
    const hbRows = await db
      .select({
        timestamp: machineHeartbeats.timestamp,
        cpuUsage: machineHeartbeats.cpuUsage,
        memoryUsage: machineHeartbeats.memoryUsage,
        diskUsage: machineHeartbeats.diskUsage,
        temperature: machineHeartbeats.temperature,
      })
      .from(machineHeartbeats)
      .where(and(
        eq(machineHeartbeats.machineId, machineId),
        gte(machineHeartbeats.timestamp, from),
      ))
      .orderBy(machineHeartbeats.timestamp);

    heartbeatSeries = hbRows.map((r) => ({
      timestamp: new Date(r.timestamp).getTime(),
      values: {
        cpu: Number(r.cpuUsage ?? 0),
        mem: Number(r.memoryUsage ?? 0),
        disk: Number(r.diskUsage ?? 0),
        temp: Number(r.temperature ?? 0),
      },
    }));

    tempSeries = hbRows
      .filter((r) => r.temperature != null)
      .map((r) => ({ timestamp: new Date(r.timestamp).getTime(), value: Number(r.temperature) }));
  }

  // Uptime since last UD event (hours)
  let uptimeSinceLastHours: number | null = null;
  const lastUd = await db
    .select({ endTime: downtimeEvents.endTime, startTime: downtimeEvents.startTime })
    .from(downtimeEvents)
    .where(and(
      eq(downtimeEvents.machineId, machineId),
      gte(downtimeEvents.startTime, from),
    ))
    .orderBy(downtimeEvents.startTime);
  if (lastUd.length > 0) {
    const last = lastUd[lastUd.length - 1];
    const ref = last.endTime ? new Date(last.endTime) : new Date(last.startTime);
    uptimeSinceLastHours = Math.max(0, (to.getTime() - ref.getTime()) / 3600_000);
  } else if (healthSeries.length > 0) {
    // No recorded failures: use observation window length as a proxy.
    uptimeSinceLastHours = (to.getTime() - healthSeries[0].timestamp) / 3600_000;
  }

  return computeFailureRiskFromInputs({
    machineId,
    reliability,
    healthSeries,
    heartbeatSeries,
    tempSeries,
    uptimeSinceLastHours,
  });
}

// ─── Cycle + background job ──────────────────────────────────────────────────

/**
 * Run one predictive-maintenance cycle over active machines.
 * For each machine: compute risk, persist a health snapshot (updating the
 * predicted* fields), and emit a MACHINE_FAILURE alert when risk + confidence +
 * timeframe all cross their thresholds. Per-machine try/catch isolates failures.
 */
export async function runPredictiveMaintenanceCycle(): Promise<{
  evaluated: number;
  alertsEmitted: number;
  workOrdersCreated: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { evaluated: 0, alertsEmitted: 0, workOrdersCreated: 0, errors: 0 };

  let evaluated = 0;
  let alertsEmitted = 0;
  let workOrdersCreated = 0;
  let errors = 0;

  const activeMachines = await db
    .select({ id: machines.id, code: machines.code })
    .from(machines)
    .where(eq(machines.isActive, true));

  for (const m of activeMachines) {
    try {
      evaluated++;
      const risk = await computeFailureRisk(m.id);

      // Persist snapshot with the updated predicted* fields (best-effort).
      // Use the latest health score if available, else derive 100 - risk.
      const latestHealth = await db
        .select({
          healthScore: machineHealthHistory.healthScore,
          oeeScore: machineHealthHistory.oeeScore,
          uptimeScore: machineHealthHistory.uptimeScore,
          errorRateScore: machineHealthHistory.errorRateScore,
          cycleTimeScore: machineHealthHistory.cycleTimeScore,
        })
        .from(machineHealthHistory)
        .where(eq(machineHealthHistory.machineId, m.id))
        // MON-F5: sắp xếp DESC để lấy bản ghi MỚI NHẤT (trước đây ASC → lấy cũ nhất).
        .orderBy(desc(machineHealthHistory.timestamp))
        .limit(1);

      const base = latestHealth[0];
      const healthScore = base ? Number(base.healthScore) : clamp(100 - risk.failureRisk);

      await recordMachineHealthSnapshot({
        machineId: m.id,
        machineCode: m.code,
        timestamp: new Date(),
        healthScore: Math.round(healthScore),
        oeeScore: base ? Number(base.oeeScore) : 0,
        uptimeScore: base ? Number(base.uptimeScore) : 0,
        errorRateScore: base ? Number(base.errorRateScore) : 0,
        cycleTimeScore: base ? Number(base.cycleTimeScore) : 0,
        predictedFailureRisk: risk.failureRisk,
        recommendedMaintenanceDate: risk.recommendedMaintenanceDate,
        maintenanceUrgency: risk.maintenanceUrgency as any,
        calculationMethod: PDM_CALC_METHOD,
        notes: risk.predictedTimeframe,
      } as any);

      // Alert gating: avoid false positives on sparse/low-confidence data.
      const timeframeOk =
        risk.predictedTimeframeHours != null && risk.predictedTimeframeHours <= TIMEFRAME_ALERT_HOURS;
      if (
        risk.failureRisk >= RISK_ALERT_THRESHOLD &&
        risk.confidenceScore >= CONFIDENCE_ALERT_THRESHOLD &&
        timeframeOk
      ) {
        try {
          const { routeAlert } = await import("./aiSmartAlertRouter");
          await routeAlert({
            type: "MACHINE_FAILURE",
            machineId: m.id,
            severity:
              risk.maintenanceUrgency === "CRITICAL" ? "CRITICAL" :
              risk.maintenanceUrgency === "HIGH" ? "HIGH" : "MEDIUM",
            message: `Predicted failure for machine ${m.code}: risk ${risk.failureRisk}% ` +
              `(confidence ${risk.confidenceScore}%), ${risk.predictedTimeframe ?? "soon"}.`,
            data: {
              confidence: risk.confidenceScore,
              predictedTimeframe: risk.predictedTimeframe,
              factors: risk.factors,
              currentValue: risk.failureRisk,
              threshold: RISK_ALERT_THRESHOLD,
            },
          });
          alertsEmitted++;
        } catch (alertErr) {
          console.error(`[PredictiveMaintenance] routeAlert failed for machine ${m.id}:`, alertErr);
        }
      }

      // R0-2 (doc 16 §9 Khối 4) — close the risk→work-order loop. When risk is
      // above the alert threshold, auto-create an idempotent PREDICTIVE work
      // order. No-op unless PDM_AUTO_WORKORDER_ENABLED=true; isolated so a
      // failure here never affects the snapshot/alert path above.
      if (risk.failureRisk >= RISK_ALERT_THRESHOLD) {
        try {
          const { maybeCreatePredictiveWorkOrder } = await import("./pdmAutoWorkOrderService");
          const created = await maybeCreatePredictiveWorkOrder(
            { id: m.id, code: m.code },
            risk,
            { healthScore: Math.round(healthScore) },
          );
          if (created) workOrdersCreated++;
        } catch (woErr) {
          console.error(`[PredictiveMaintenance] auto work-order failed for machine ${m.id}:`, woErr);
        }
      }
    } catch (err) {
      errors++;
      console.error(`[PredictiveMaintenance] machine ${m.id} failed:`, (err as Error)?.message ?? err);
    }
  }

  return { evaluated, alertsEmitted, workOrdersCreated, errors };
}

// ─── Background job (pattern: alertEvaluationService) ────────────────────────

let pmInterval: NodeJS.Timeout | null = null;
let pmRunning = false;

/**
 * Run one cycle but skip if a previous cycle is still in flight. Guards against
 * overlapping runs when a cycle takes longer than the tick interval (a slow
 * cycle must never stack on top of itself).
 */
async function runPredictiveMaintenanceCycleGuarded(): Promise<void> {
  if (pmRunning) {
    console.log("[PredictiveMaintenance] Previous cycle still running, skipping this tick");
    return;
  }
  pmRunning = true;
  try {
    await runPredictiveMaintenanceCycle();
  } finally {
    pmRunning = false;
  }
}

export function startPredictiveMaintenanceJob(intervalMinutes = 30): void {
  if (pmInterval) {
    console.log("[PredictiveMaintenance] Job already running");
    return;
  }
  if (process.env.PREDICTIVE_MAINTENANCE_ENABLED !== "true") {
    console.log("[PredictiveMaintenance] Disabled (set PREDICTIVE_MAINTENANCE_ENABLED=true to enable)");
    return;
  }

  console.log(`[PredictiveMaintenance] Starting job (interval: ${intervalMinutes} minute(s))`);

  runPredictiveMaintenanceCycleGuarded().catch((err) => {
    console.error("[PredictiveMaintenance] Initial cycle failed:", err);
  });

  pmInterval = setInterval(() => {
    runPredictiveMaintenanceCycleGuarded().catch((err) => {
      console.error("[PredictiveMaintenance] Cycle failed:", err);
    });
  }, intervalMinutes * 60 * 1000);
}

export function stopPredictiveMaintenanceJob(): void {
  if (pmInterval) {
    clearInterval(pmInterval);
    pmInterval = null;
    console.log("[PredictiveMaintenance] Job stopped");
  }
}
