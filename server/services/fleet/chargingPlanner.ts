/**
 * Khối 2 (doc 16 §7 part d / §15 G2) — Predictive charging planner.
 * Flag: FLEET_RESOURCE_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Given a mobile device's battery telemetry + a SIMPLE energy-per-task model, decide
 * whether it should be sent to charge PREEMPTIVELY — i.e. before its assigned task
 * queue would drain it below the G1 battery floor.
 *
 * ENERGY MODEL (HONEST: heuristic, not physics). Each queued task costs a flat
 * `energyPerTaskPct` (env FLEET_ENERGY_PER_TASK_PCT, default 8%). Projected battery
 * after the queue = current% − (queueLength × energyPerTaskPct). If that projection
 * is below the FLOOR (reused from the G1 allocator — FLEET_BATTERY_FLOOR_PCT, default
 * 20%), a charge is needed; the deficit drives an estimated charge duration via a
 * flat `chargeRatePctPerMin` (env FLEET_CHARGE_RATE_PCT_PER_MIN, default 1.5%/min).
 *
 * The planner DOES NOT exclude battery-low devices from allocation itself — the G1
 * allocator ALREADY hard-excludes a mobile robot below the floor (taskAllocator
 * BATTERY_FLOOR_PCT). This module is the PROACTIVE complement: it schedules a charge
 * BEFORE the robot crosses the floor, so it never reaches the excluded state mid-shift.
 * We deliberately do NOT duplicate the floor exclusion.
 *
 * SAFETY: writes `battery_charging_plans` STATE only — it does not command a robot to
 * move to a charger. A FOE workflow / dispatcher consumes a 'planned' row and issues
 * the actual move through the gated dispatcher. With the flag off the sweep is a no-op.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { batteryChargingPlans } from "../../../drizzle/schema/fleetResource";
import { tasks, robots, robotTelemetry } from "../../../drizzle/schema";
import { fleetResourceEnabled } from "./skillRegistry";

// Reuse the SAME floor the G1 allocator uses (do not duplicate the constant's meaning).
const BATTERY_FLOOR_PCT = Number(process.env.FLEET_BATTERY_FLOOR_PCT ?? 20);
const ENERGY_PER_TASK_PCT = Number(process.env.FLEET_ENERGY_PER_TASK_PCT ?? 8);
const CHARGE_RATE_PCT_PER_MIN = Number(process.env.FLEET_CHARGE_RATE_PCT_PER_MIN ?? 1.5);
// Target charge level a plan aims for (so it does not immediately re-trigger).
const CHARGE_TARGET_PCT = Number(process.env.FLEET_CHARGE_TARGET_PCT ?? 90);

export interface ChargeNeed {
  needsCharge: boolean;
  projectedPct: number;
  deficitPct: number; // how far below floor the projection lands (0 if not below)
  estimatedDurationMs: number; // 0 when no charge needed
  reason: string;
}

/**
 * PURE — project end-of-queue battery and decide if a preemptive charge is needed.
 * Deterministic + side-effect free → unit-testable.
 */
export function projectChargeNeed(
  currentPct: number,
  queueLength: number,
  opts?: { energyPerTaskPct?: number; floorPct?: number; chargeRatePctPerMin?: number; targetPct?: number },
): ChargeNeed {
  const energyPerTask = opts?.energyPerTaskPct ?? ENERGY_PER_TASK_PCT;
  const floor = opts?.floorPct ?? BATTERY_FLOOR_PCT;
  const rate = opts?.chargeRatePctPerMin ?? CHARGE_RATE_PCT_PER_MIN;
  const target = opts?.targetPct ?? CHARGE_TARGET_PCT;

  const projectedPct = currentPct - queueLength * energyPerTask;
  if (projectedPct >= floor) {
    return { needsCharge: false, projectedPct, deficitPct: 0, estimatedDurationMs: 0, reason: `projected ${projectedPct}% >= floor ${floor}%` };
  }
  const deficitPct = floor - projectedPct;
  // Charge from current up to target (clamped) → minutes → ms.
  const chargeAmountPct = Math.max(0, target - currentPct);
  const estimatedDurationMs = rate > 0 ? Math.round((chargeAmountPct / rate) * 60_000) : 0;
  return {
    needsCharge: true,
    projectedPct,
    deficitPct,
    estimatedDurationMs,
    reason: `projected ${projectedPct}% < floor ${floor}% after ${queueLength} task(s)`,
  };
}

/** Pull battery % from a robot pose JSON (same shape the G1 allocator reads). */
function extractBattery(pose: Record<string, unknown> | null): number | null {
  if (!pose) return null;
  const b = pose.battery as { charge?: number } | number | undefined;
  if (typeof b === "number") return b;
  if (b && typeof b.charge === "number") return b.charge;
  return null;
}

export interface SweepResult {
  ok: boolean;
  enabled: boolean;
  scheduled: number;
  skipped: number;
  message?: string;
}

/**
 * Sweep mobile robots: for each AGV with a known battery, project its end-of-queue
 * battery and, if it would drop below the floor, schedule a 'planned' charge (unless
 * an open plan already exists for that device — idempotent per open plan). No-op
 * unless FLEET_RESOURCE_ENABLED.
 */
export async function sweepChargingPlans(): Promise<SweepResult> {
  if (!fleetResourceEnabled()) return { ok: false, enabled: false, scheduled: 0, skipped: 0, message: "FLEET_RESOURCE_ENABLED off" };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, scheduled: 0, skipped: 0, message: "db unavailable" };

  const robotRows = await db.select().from(robots).where(eq(robots.isEnabled, true));
  const mobile = robotRows.filter((r) => r.kind === "agv");
  if (mobile.length === 0) return { ok: true, enabled: true, scheduled: 0, skipped: 0 };

  // Open-task counts per device (assigned/running) → queue length for the model.
  const openTasks = await db.select().from(tasks).where(inArray(tasks.status, ["assigned", "running"]));
  const queueByDevice = new Map<number, number>();
  for (const t of openTasks) {
    if (t.assignedDeviceId != null) queueByDevice.set(t.assignedDeviceId, (queueByDevice.get(t.assignedDeviceId) ?? 0) + 1);
  }

  let scheduled = 0;
  let skipped = 0;
  for (const r of mobile) {
    const [tel] = await db
      .select()
      .from(robotTelemetry)
      .where(eq(robotTelemetry.robotId, r.id))
      .orderBy(desc(robotTelemetry.timestamp))
      .limit(1);
    const battery = extractBattery((tel?.poseJson ?? null) as Record<string, unknown> | null);
    if (battery == null) { skipped++; continue; }

    const need = projectChargeNeed(battery, queueByDevice.get(r.id) ?? 0);
    if (!need.needsCharge) { skipped++; continue; }

    // Idempotent: skip if an open (planned/active) plan already exists for this device.
    const [openPlan] = await db
      .select()
      .from(batteryChargingPlans)
      .where(and(eq(batteryChargingPlans.deviceId, r.id), inArray(batteryChargingPlans.status, ["planned", "active"])))
      .limit(1);
    if (openPlan) { skipped++; continue; }

    await db.insert(batteryChargingPlans).values({
      deviceId: r.id,
      deviceKind: "robot",
      plannedStartAt: new Date(),
      estimatedDurationMs: need.estimatedDurationMs,
      currentEnergyPct: Math.round(battery),
      reason: need.reason,
      status: "planned",
      corporateCode: null,
      factoryId: null,
    });
    scheduled++;
    console.log(`[Fleet] charging plan for device ${r.id}: ${need.reason} (~${Math.round(need.estimatedDurationMs / 60000)}min)`);
  }
  return { ok: true, enabled: true, scheduled, skipped };
}
