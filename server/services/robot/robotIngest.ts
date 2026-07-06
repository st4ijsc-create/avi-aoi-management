/**
 * Phase 3 — Robot state ingest: RobotState → robot_telemetry row.
 */
import { getDb } from "../../db/connection";
import { robotTelemetry, robots } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { RuntimeRobot } from "./robotAdapter";
import type { RobotState } from "./robotDriver";

// S1-b — per-robot last-observed e-stop flag, to record a safety_event only on the
// TRANSITION into e-stop (not on every poll while it stays asserted). In-process,
// best-effort; a process restart simply re-arms (a fresh estop is then logged once).
const lastEstop = new Map<number, boolean>();
// doc 22 P3 — per-robot last-observed fault flag, so a fault-triggered fleet rebalance
// fires only on the TRANSITION into a faulted state (not on every poll while faulted).
const lastFaulted = new Map<number, boolean>();

type RobotTelemetryRow = typeof robotTelemetry.$inferInsert;

// ── R-2a (doc 38 P0-D/P1-I) — robot ingest write-coalescing (default OFF) ─────
// Each robot poll historically did 1 INSERT (robot_telemetry) + 1 UPDATE (robots
// registry) per robot per tick. Two additive, flag-gated reductions:
//   1) ROBOT_INGEST_COALESCE_ENABLED (default OFF) — buffer telemetry rows and flush
//      them as ONE multi-row insert (coalesces across robots + ticks). When OFF the
//      insert is immediate — byte-for-byte the prior behaviour.
//   2) The registry UPDATE is lifted off the hot path: it is written only on a STATUS
//      TRANSITION or at most every ROBOT_REGISTRY_UPDATE_MS (default 15000ms). This
//      applies ONLY in the coalescing path; the OFF path keeps the original per-poll
//      update. The live socket emit + heartbeat/anomaly/safety hooks still fire EVERY
//      state, so cockpit liveness + field-health are unaffected either way.
function robotCoalesceEnabled(): boolean {
  return process.env.ROBOT_INGEST_COALESCE_ENABLED === "true";
}
function robotIntEnv(name: string, def: number, min = 1): number {
  const n = parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(n) && n >= min ? n : def;
}

let robotBuffer: RobotTelemetryRow[] = [];
let robotFlushTimer: ReturnType<typeof setTimeout> | null = null;
let robotShutdownWired = false;
const lastRegistryStatus = new Map<number, string>();
const lastRegistryAt = new Map<number, number>();

function ensureRobotShutdownFlush(): void {
  if (robotShutdownWired) return;
  robotShutdownWired = true;
  try {
    process.on("beforeExit", () => { void flushRobotTelemetry(); });
  } catch {
    // no process → best-effort only
  }
}

function scheduleRobotFlush(): void {
  if (robotFlushTimer) return;
  const t = setTimeout(() => { robotFlushTimer = null; void flushRobotTelemetry(); },
    robotIntEnv("ROBOT_TELEMETRY_FLUSH_MS", 500));
  if (typeof (t as { unref?: () => void }).unref === "function") (t as { unref: () => void }).unref();
  robotFlushTimer = t;
}

/** Flush buffered robot telemetry rows as ONE multi-row insert. Never throws. */
export async function flushRobotTelemetry(): Promise<number> {
  if (robotFlushTimer) { clearTimeout(robotFlushTimer); robotFlushTimer = null; }
  if (robotBuffer.length === 0) return 0;
  const batch = robotBuffer;
  robotBuffer = [];
  try {
    const db = await getDb();
    if (!db) return 0; // DB absent → matches the OFF path's getDb() guard.
    await db.insert(robotTelemetry).values(batch);
    return batch.length;
  } catch (err) {
    console.error("[Robot] telemetry flush failed:", (err as Error)?.message ?? err);
    return 0;
  }
}

/** Build the canonical robot_telemetry insert row (shared by immediate + batch paths). */
function buildRobotTelemetryRow(robot: RuntimeRobot, state: RobotState, now: Date): RobotTelemetryRow {
  return {
    robotId: robot.id,
    mode: state.mode,
    busy: state.busy,
    estop: state.estop,
    poseJson: state.pose as Record<string, unknown> | undefined,
    payloadKg: state.payloadKg != null ? String(state.payloadKg) : undefined,
    speedPct: state.speedPct,
    errorText: state.error,
    // X1-a (doc 16 §5) — UDM/UEM extension columns. Honest NULL when the producer
    // has no value (jointStates/firmwareVersion are seams; batteryLevel is wired
    // from the VDA5050 battery extraction for AGVs). lastHeartbeat = the moment we
    // observed this snapshot → feeds the X1-b heartbeat TTL stale sweep.
    batteryLevel: state.batteryPct != null ? String(state.batteryPct) : undefined,
    jointStates: state.jointStates,
    safetyZoneId: state.safetyZoneId,
    firmwareVersion: state.firmwareVersion,
    lastHeartbeat: state.timestamp ?? now,
    timestamp: state.timestamp ?? now,
  };
}

/**
 * Throttled registry (robots row) liveness update — writes ONLY on a status change or
 * every ROBOT_REGISTRY_UPDATE_MS. Fire-and-forget so it never blocks the poll loop; a
 * write error is logged (never swallowed silently). Used by the coalescing path.
 */
function updateRegistryThrottled(robotId: number, newStatus: string, now: Date): void {
  const prevStatus = lastRegistryStatus.get(robotId);
  const prevAt = lastRegistryAt.get(robotId) ?? 0;
  const dueMs = robotIntEnv("ROBOT_REGISTRY_UPDATE_MS", 15000);
  if (prevStatus === newStatus && now.getTime() - prevAt < dueMs) return;
  lastRegistryStatus.set(robotId, newStatus);
  lastRegistryAt.set(robotId, now.getTime());
  void (async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.update(robots).set({ status: newStatus, lastSeenAt: now }).where(eq(robots.id, robotId));
    } catch (err) {
      console.error(`[Robot] registry update failed for robot ${robotId}:`, (err as Error)?.message ?? err);
    }
  })();
}

/**
 * R-2a — batch ingest of MANY robot states (one tick, many robots) as ONE multi-row
 * insert. Registry updates are throttled; per-robot live emit + heartbeat/anomaly/
 * safety hooks fire for every state. Never throws. (Batch helper for a future
 * multi-robot poll caller; ingestRobotState remains the per-robot entry.)
 */
export async function ingestRobotStates(
  entries: Array<{ robot: RuntimeRobot; state: RobotState }>,
): Promise<void> {
  if (!entries || entries.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  try {
    await db.insert(robotTelemetry).values(entries.map((e) => buildRobotTelemetryRow(e.robot, e.state, now)));
  } catch (err) {
    console.error("[Robot] batch ingest insert failed:", (err as Error)?.message ?? err);
  }
  for (const { robot, state } of entries) {
    const newStatus = state.estop ? "estop" : state.busy ? "busy" : "idle";
    updateRegistryThrottled(robot.id, newStatus, now);
    await runRobotSideEffects(robot, state, newStatus, now);
  }
}

export async function ingestRobotState(robot: RuntimeRobot, state: RobotState): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const newStatus = state.estop ? "estop" : state.busy ? "busy" : "idle";
  try {
    if (robotCoalesceEnabled()) {
      // Coalesced path: buffer the insert + throttle the registry update.
      ensureRobotShutdownFlush();
      robotBuffer.push(buildRobotTelemetryRow(robot, state, now));
      if (robotBuffer.length >= robotIntEnv("ROBOT_TELEMETRY_MAX_BATCH", 200)) {
        void flushRobotTelemetry();
      } else {
        scheduleRobotFlush();
      }
      updateRegistryThrottled(robot.id, newStatus, now);
    } else {
      // Legacy path — immediate insert + immediate registry update (unchanged).
      await db.insert(robotTelemetry).values(buildRobotTelemetryRow(robot, state, now));
      await db.update(robots)
        .set({ status: newStatus, lastSeenAt: now })
        .where(eq(robots.id, robot.id));
    }

    await runRobotSideEffects(robot, state, newStatus, now);
  } catch (err) {
    console.error(`[Robot] ingest failed for "${robot.code}":`, (err as Error)?.message ?? err);
  }
}

/**
 * Per-state side effects: LIVE socket emit + heartbeat + fleet-rebalance + safety
 * audit + anomaly scan. Extracted UNCHANGED so both the single and batch ingest paths
 * fire them identically. All are fire-and-forget + individually error-isolated.
 */
async function runRobotSideEffects(robot: RuntimeRobot, state: RobotState, newStatus: string, now: Date): Promise<void> {
    // U3-live (doc 21 §6 / G-5) — fire-and-forget LIVE socket emit of the compact UDM
    // to the per-robot room `robot:{id}` so the Robot Cockpit renders live (robot pages
    // were poll/static before). Transport-only (telemetry is NOT a control path), so it
    // is ungated; error-isolated so a socket failure can NEVER break the persist path.
    // No-op when io is not initialized (tests / headless) → FE simply keeps its poll.
    try {
      const { emitRobotTelemetry } = await import("../../_core/socket");
      emitRobotTelemetry({
        robotId: robot.id,
        robotCode: robot.code,
        mode: state.mode ?? null,
        busy: state.busy ?? null,
        estop: state.estop ?? null,
        speedPct: state.speedPct ?? null,
        pose: (state.pose ?? null) as Record<string, unknown> | null,
        jointStates: state.jointStates ?? null,
        batteryPct: state.batteryPct ?? null,
        safetyZoneId: state.safetyZoneId ?? null,
        firmwareVersion: state.firmwareVersion ?? null,
        error: state.error ?? null,
        status: newStatus,
        ts: (state.timestamp ?? now).getTime(),
      });
    } catch (e) {
      console.error(`[Robot] telemetry emit failed for "${robot.code}":`, (e as Error)?.message ?? e);
    }

    // X1-b (doc 16 §5) — record the heartbeat into the field-health ledger so the
    // stale sweep can detect lost connections. Fire-and-forget + self-gated by
    // FIELD_V2_ENABLED (no-op when off) → zero cost on the default path.
    void import("../field/fieldHealthService")
      .then((m) => m.recordHeartbeat({ deviceKey: `robot:${robot.id}`, deviceKind: "robot", robotId: robot.id, at: state.timestamp ?? now }))
      .catch((e) => console.error(`[Robot] heartbeat record failed for "${robot.code}":`, (e as Error)?.message ?? e));

    // G1 (doc 16 Khối 2) — if the robot just hit a failed state, hand its open tasks
    // to another device. Fire-and-forget; the rebalancer is itself gated by
    // FLEET_ORCH_ENABLED (no-op when off) and opens NO control path.
    //   • e-stop            → always rebalance.
    //   • doc 22 P3 fault   → a robot reporting an error/fault can no longer service its
    //                         work → rebalance on the TRANSITION into a faulted state
    //                         (mirrors the estop transition guard to avoid re-firing).
    // (robot offline / heartbeat-timeout is separately covered by the field-health
    //  stale sweep → reactToLostConnection → rebalanceDeviceTasks.)
    const wasFaulted = lastFaulted.get(robot.id) ?? false;
    const isFaulted = !!state.error;
    if (state.estop) {
      void import("../fleet/taskAllocator")
        .then((m) => m.rebalanceDeviceTasks(robot.id, "robot_estop"))
        .catch((e) => console.error(`[Robot] rebalance hook failed for "${robot.code}":`, (e as Error)?.message ?? e));
    } else if (isFaulted && !wasFaulted) {
      void import("../fleet/taskAllocator")
        .then((m) => m.rebalanceDeviceTasks(robot.id, "robot_fault"))
        .catch((e) => console.error(`[Robot] fault-rebalance hook failed for "${robot.code}":`, (e as Error)?.message ?? e));
    }
    lastFaulted.set(robot.id, isFaulted);

    // S1-b (doc 16 Khối 3) — ADVISORY safety audit on the e-stop TRANSITION only.
    // Fire-and-forget + lazily imported + self-gated by SAFETY_AUDIT_ENABLED → no-op
    // when off. This ONLY LOGS (outcome=logged_only); it does NOT change control
    // behaviour and is NOT a safety-rated stop — the software merely observed it.
    const wasEstop = lastEstop.get(robot.id) ?? false;
    if (state.estop && !wasEstop) {
      void import("../safety/safetyAuditService")
        .then((m) => m.record({
          eventType: "estop",
          robotId: robot.id,
          detectedBy: "telemetry",
          handledBy: "advisory",
          outcome: "logged_only",
          robotState: { mode: state.mode, busy: state.busy, error: state.error ?? null },
          notes: `ADVISORY: e-stop observed via telemetry on "${robot.code}" (software logged only — not a safety-rated stop)`,
        }))
        .catch((e) => console.error(`[Robot] safety-audit hook failed for "${robot.code}":`, (e as Error)?.message ?? e));
    }
    lastEstop.set(robot.id, !!state.estop);

    // I2-a (doc 16 Khối 4) — ADVISORY robot-behaviour anomaly scan (trajectory /
    // grip-force / cycle-time drift). Fire-and-forget + lazily imported + self-gated
    // by AI_ROBOT_ANOMALY_ENABLED (no-op when off) → zero cost on the default path.
    // Opens NO control path: it raises a smart alert + writes an advisory ledger row,
    // NEVER a robot command.
    void import("../ai/robotBehaviorAnomalyService")
      .then((m) => m.detectAndRaiseForRobot(robot.id))
      .catch((e) => console.error(`[Robot] anomaly-scan hook failed for "${robot.code}":`, (e as Error)?.message ?? e));
}
