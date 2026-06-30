/**
 * S1-c (doc 16 §8 c / §15 S1) — Andon → robot dispatch loop.
 * Flag: ANDON_ROBOT_DISPATCH_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * When a 'call'/help Andon is raised for a reason that a robot can ASSIST with
 * ({maintenance, material, other}) AND the flag is on AND the fleet layer is
 * available (FLEET_ORCH_ENABLED), this creates a fleet `task` (an "assist at the
 * Andon's station/location") so the EXISTING taskAllocator picks an idle, capable
 * robot. The linkage (andonEventId ↔ taskId) is recorded on the task payload + a
 * stable taskKey `andon:<id>:assist` for idempotency.
 *
 * SAFETY: this writes orchestration STATE only (a `tasks` row). It commands NO
 * device — the assigned task is consumed later by a FOE workflow / scheduler that
 * routes through the gated robotCommandDispatcher / commandDispatcher (dry-run by
 * default). When the flag is OFF, this is a complete no-op and the existing Andon
 * behaviour is UNCHANGED.
 *
 * Called fire-and-forget from raiseAndon (lazy-imported) so andonService keeps no
 * static dependency on the fleet module graph (andon unit tests stay green).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { tasks } from "../../../drizzle/schema";
import type { AndonEvent } from "../../../drizzle/schema";

/** Flag — default OFF. */
export function andonRobotDispatchEnabled(): boolean {
  return process.env.ANDON_ROBOT_DISPATCH_ENABLED === "true" || process.env.ANDON_ROBOT_DISPATCH_ENABLED === "1";
}

/** Andon reasons a robot can be dispatched to assist with. */
const DISPATCHABLE_REASONS = new Set(["maintenance", "material", "other"]);

/** The canonical capability an assist task requires (a robot that can run a job). */
const ASSIST_CAPABILITY = "run_job";

export interface AndonDispatchResult {
  ok: boolean;
  enabled: boolean;
  taskId?: number;
  assignedDeviceId?: number;
  reason?: string;
}

/**
 * Maybe create + allocate an assist task for a 'call'/help Andon. No-op unless
 * ANDON_ROBOT_DISPATCH_ENABLED + the andon is a dispatchable call + fleet is enabled.
 */
export async function maybeDispatchRobotForAndon(andon: AndonEvent): Promise<AndonDispatchResult> {
  if (!andonRobotDispatchEnabled()) return { ok: false, enabled: false, reason: "ANDON_ROBOT_DISPATCH_ENABLED off" };

  // Only a 'call' (help) Andon for an assist-able reason triggers a robot.
  if (andon.state !== "call" || !DISPATCHABLE_REASONS.has(andon.reason)) {
    return { ok: false, enabled: true, reason: `not a dispatchable help call (state=${andon.state}, reason=${andon.reason})` };
  }

  // Fleet layer must be available — reuse its flag + allocator (no duplicate logic).
  const { fleetOrchEnabled, allocateTask } = await import("../fleet/taskAllocator");
  if (!fleetOrchEnabled()) return { ok: false, enabled: true, reason: "FLEET_ORCH_ENABLED off (fleet unavailable)" };

  const d = await getDb();
  if (!d) return { ok: false, enabled: true, reason: "db unavailable" };

  // Idempotent: one assist task per Andon event.
  const taskKey = `andon:${andon.id}:assist`;
  const [existing] = await d.select().from(tasks).where(eq(tasks.taskKey, taskKey)).limit(1);
  let taskId = existing?.id;
  if (!taskId) {
    const [row] = await d
      .insert(tasks)
      .values({
        taskKey,
        requiredCapability: ASSIST_CAPABILITY,
        priority: andon.reason === "maintenance" ? 4 : 3,
        status: "pending",
        // Spatial hint — the Andon's station (allocator uses zone codes; this is metadata).
        locationStart: andon.stationId != null ? `station:${andon.stationId}` : null,
        payload: {
          source: "andon_dispatch",
          andonEventId: andon.id,
          andonReason: andon.reason,
          lineId: andon.lineId,
          stationId: andon.stationId,
          machineId: andon.machineId,
        },
      })
      .returning({ id: tasks.id });
    taskId = row?.id;
  }
  if (!taskId) return { ok: false, enabled: true, reason: "task creation failed" };

  // Let the EXISTING allocator pick an idle capable robot (self-gated, no control path).
  const decision = await allocateTask(taskId);
  return { ok: true, enabled: true, taskId, assignedDeviceId: decision.assignedDeviceId };
}
