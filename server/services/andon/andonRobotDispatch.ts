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
  /**
   * ADVISORY software latency (ms) from the Andon being raised (detection) → this
   * assist-task dispatch PROPOSAL, for ISO/TS 15066 PDCA reporting. Mirrored onto the
   * advisory safety_events.responseTimeMs. This is a monitoring measurement of the
   * orchestration reaction — NOT a safety-rated response-time guarantee; the dispatch
   * commands no device (it only creates a `tasks` row).
   */
  responseTimeMs?: number;
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

  // ADVISORY latency: ms from the Andon being raised (detection) → this dispatch
  // proposal. Clamped ≥0 so clock skew never yields a negative. Software/orchestration
  // measurement only — NOT a safety-rated response time.
  const raisedAtMs = andon.raisedAt instanceof Date ? andon.raisedAt.getTime() : Date.parse(String(andon.raisedAt ?? ""));
  const responseTimeMs = Number.isFinite(raisedAtMs) ? Math.max(0, Date.now() - raisedAtMs) : undefined;

  // Record an ADVISORY safety_event stamping the response latency (PDCA). Self-gated by
  // SAFETY_AUDIT_ENABLED (record() no-ops when off) + lazily imported so this module
  // keeps no static dependency on the safety graph. Fire-and-forget: never blocks or
  // fails the dispatch, and opens NO control path (this only LOGS).
  void import("../safety/safetyAuditService")
    .then((m) =>
      m.record({
        eventType: "intrusion",
        robotId: decision.assignedDeviceId ?? null,
        lineId: andon.lineId ?? null,
        stationId: andon.stationId ?? null,
        responseTimeMs: responseTimeMs ?? null,
        // Honest provenance: the andon→robot dispatch is an ADVISORY orchestration
        // reaction, not a real sensor observation → 'operator' (a human raised the Andon).
        detectedBy: "operator",
        handledBy: "advisory",
        outcome: "logged_only",
        isNearMiss: false,
        notes: `ADVISORY andon→robot assist dispatch (andon #${andon.id}, reason ${andon.reason}, task #${taskId}). responseTimeMs=raise→dispatch-proposal. NOT a safety-rated stop — orchestration only.`,
      }),
    )
    .catch((e) => console.error("[Andon] safety-event stamp failed:", (e as Error)?.message ?? e));

  return { ok: true, enabled: true, taskId, assignedDeviceId: decision.assignedDeviceId, responseTimeMs };
}
