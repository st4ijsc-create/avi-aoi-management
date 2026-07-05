/**
 * Khối 2 (doc 16 §7) — Dynamic Task Allocation Engine.  Flag: FLEET_ORCH_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Picks the best DEVICE for a task and (optionally) persists the assignment, then
 * REBALANCES a device's open tasks when it goes offline/failed mid-work.
 *
 * SCORING (documented, reuses dispatchingService priority/aging weighting so we do
 * NOT reinvent the WIP ranking):
 *   (1) capability match  — HARD filter via capabilityModel: a candidate is eligible
 *                           only if its resolved profile supports the task's
 *                           requiredCapability verb. Non-matching → excluded.
 *   (2) distance/position — robot pose (robot_telemetry.poseJson.cartesian) vs the
 *                           task's locationStart. If either is missing → a documented
 *                           neutral fallback (no distance penalty; logged-less).
 *   (3) battery (mobile)  — for AGV/mobile robots, battery from telemetry (VDA5050
 *                           surfaces it in pose JSON). Low battery → penalty; below a
 *                           hard floor → excluded (can't safely take work).
 *   (4) queue length      — count of the device's open (assigned/running) tasks;
 *                           longer queue → penalty (load-balance).
 *   (5) order priority    — the task's own priority (1..5) re-uses the
 *                           dispatchingService W_PRIORITY weight.
 *
 * SAFETY: this engine only writes orchestration STATE (the `tasks` row). It NEVER
 * commands a device — dispatch stays with robotCommandDispatcher / commandDispatcher
 * (HITL + dry-run). With FLEET_ORCH_ENABLED off, the DB-bound mutating entry points
 * are no-ops.
 *
 * PERFORMANCE: target <500ms/allocate. Capability profiles are resolved through a
 * small in-process cache keyed by capability-class so a batch allocate does not
 * re-clone the profile table per candidate.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { tasks, robots, robotTelemetry } from "../../../drizzle/schema";
import type { Task } from "../../../drizzle/schema/fleet";
import { getDefaultCapability, type EquipmentCapability } from "../equipment/capabilityModel";
import { publishTaskEvent } from "../ecosystem/ecosystemEvents";
import { recordDecision } from "../observability/decisionTrace"; // doc 33 I1 (F6): "why device X chosen"

/**
 * doc 33 I1 — emit an F6 decision-trace for an allocation so the Control Tower can answer
 * "vì sao device X được chọn cho task Y?" (candidate set + scores + eliminating reasons +
 * allocator version). Best-effort: a bounded in-memory ring; never throws into the allocator.
 */
function traceAllocation(subject: string, decision: AllocationDecision, note?: string): void {
  try {
    recordDecision({
      decisionType: "task-allocation",
      subject,
      chosen: decision.best ? String(decision.best.deviceId) : null,
      candidates: decision.ranked.map((r) => ({
        id: String(r.deviceId),
        score: Number.isFinite(r.score) ? r.score : -999999,
        eliminatedBy: r.eligible ? undefined : r.reasons[0],
      })),
      version: "fleet-allocator-g1",
      ts: Date.now(),
      note,
    });
  } catch {
    /* decision-trace is best-effort observability — never affect allocation */
  }
}

/** Flag — default OFF (mirrors foeEnabled / erpInboundEnabled). */
export function fleetOrchEnabled(): boolean {
  return process.env.FLEET_ORCH_ENABLED === "true" || process.env.FLEET_ORCH_ENABLED === "1";
}

// Re-use the dispatchingService priority weight so scoring stays consistent.
const W_PRIORITY = Number(process.env.DISPATCH_W_PRIORITY ?? 100);
// Fleet-specific weights (tunable via env, sensible defaults).
const W_DISTANCE = Number(process.env.FLEET_W_DISTANCE ?? 2); // penalty per metre
const W_QUEUE = Number(process.env.FLEET_W_QUEUE ?? 50); // penalty per queued task
const W_BATTERY = Number(process.env.FLEET_W_BATTERY ?? 1.5); // bonus per % battery
// A mobile robot below this battery % is excluded (can't safely take work).
const BATTERY_FLOOR_PCT = Number(process.env.FLEET_BATTERY_FLOOR_PCT ?? 20);

/** Map a robots.kind to the capability class used for profile resolution. */
export function robotKindToCapabilityClass(kind: string | null | undefined): string {
  switch (kind) {
    case "agv":
      return "ROBOT"; // mobile robot — same verb set; treated as mobile for battery
    case "scara":
    case "cobot":
    case "arm":
    default:
      return "ROBOT";
  }
}

/** A device the allocator may assign work to (pure input — no DB shape leaks in). */
export interface AllocCandidate {
  deviceId: number;
  deviceKind: "robot";
  /** Capability class to resolve the profile (e.g. "ROBOT"). */
  capabilityClass: string;
  /** Is this a mobile robot (battery-gated)? */
  mobile: boolean;
  /** Liveness — only idle/busy-but-online devices are eligible. */
  online: boolean;
  /** Current Cartesian position (zone-less spatial hint), if known. */
  position?: { x: number; y: number } | null;
  /** Battery % (0..100) for mobile robots, if known. */
  batteryPct?: number | null;
  /** Count of this device's open (assigned/running) tasks. */
  queueLength: number;
}

/** A task the allocator scores candidates against (pure subset of the Task row). */
export interface AllocTaskInput {
  requiredCapability: string;
  priority?: number; // 1..5 (default 3)
  /** Cartesian position the work starts at, if known (for distance scoring). */
  startPosition?: { x: number; y: number } | null;
}

export interface ScoredCandidate {
  deviceId: number;
  score: number;
  eligible: boolean;
  reasons: string[]; // i18n-able reason codes
}

export interface AllocationDecision {
  taskCapability: string;
  best: ScoredCandidate | null;
  ranked: ScoredCandidate[];
}

// ── capability profile cache (keyed by class) ───────────────────────────────
const profileCache = new Map<string, EquipmentCapability>();
function resolveProfile(capabilityClass: string): EquipmentCapability {
  let p = profileCache.get(capabilityClass);
  if (!p) {
    p = getDefaultCapability(capabilityClass);
    profileCache.set(capabilityClass, p);
  }
  return p;
}
/** Test/maintenance hook — clear the in-process capability cache. */
export function _clearProfileCache(): void {
  profileCache.clear();
}

function hasCapability(capabilityClass: string, verb: string): boolean {
  return resolveProfile(capabilityClass).supportedCommands.some((c) => c.name === verb);
}

/**
 * W4-18 (2) — Does a robot of `kind` support the capability verb? Exported so the
 * fleetRouter.assign path can HARD-validate a manual (re)assignment against the same
 * capability model the allocator uses, instead of blindly writing the assignment.
 */
export function deviceSupportsCapability(kind: string | null | undefined, verb: string): boolean {
  return hasCapability(robotKindToCapabilityClass(kind), verb);
}

function distance(a?: { x: number; y: number } | null, b?: { x: number; y: number } | null): number | null {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * PURE scoring — pick the best candidate for a task. Deterministic + side-effect
 * free so it is trivially unit-testable. Eligibility is a HARD gate (capability,
 * online, battery floor); ineligible candidates score -Infinity and are excluded
 * from `best`.
 */
export function scoreCandidates(task: AllocTaskInput, candidates: AllocCandidate[]): AllocationDecision {
  const priority = task.priority ?? 3;

  const ranked: ScoredCandidate[] = candidates.map((c) => {
    const reasons: string[] = [];

    // (1) capability — HARD filter.
    if (!hasCapability(c.capabilityClass, task.requiredCapability)) {
      return { deviceId: c.deviceId, score: -Infinity, eligible: false, reasons: ["capability_mismatch"] };
    }
    // liveness — HARD filter.
    if (!c.online) {
      return { deviceId: c.deviceId, score: -Infinity, eligible: false, reasons: ["offline"] };
    }
    // (3a) battery floor — HARD filter for mobile robots.
    if (c.mobile && c.batteryPct != null && c.batteryPct < BATTERY_FLOOR_PCT) {
      return { deviceId: c.deviceId, score: -Infinity, eligible: false, reasons: ["battery_too_low"] };
    }

    let score = 0;
    reasons.push("capability_ok");

    // (5) order priority (shared weight with dispatchingService).
    score += priority * W_PRIORITY;
    if (priority >= 4) reasons.push("high_priority");

    // (2) distance — closer is better. Missing spatial data → neutral fallback.
    const d = distance(c.position, task.startPosition);
    if (d != null) {
      score -= d * W_DISTANCE;
      if (d <= 5) reasons.push("nearby");
    } else {
      reasons.push("distance_unknown");
    }

    // (3b) battery — for mobile robots, more charge is better.
    if (c.mobile) {
      if (c.batteryPct != null) {
        score += c.batteryPct * W_BATTERY;
        if (c.batteryPct >= 80) reasons.push("battery_healthy");
      } else {
        reasons.push("battery_unknown");
      }
    }

    // (4) queue length — fewer open tasks is better (load-balance).
    score -= c.queueLength * W_QUEUE;
    if (c.queueLength === 0) reasons.push("idle_queue");

    return { deviceId: c.deviceId, score: Math.round(score * 100) / 100, eligible: true, reasons };
  });

  ranked.sort((a, b) => b.score - a.score || a.deviceId - b.deviceId);
  const best = ranked.find((r) => r.eligible) ?? null;
  return { taskCapability: task.requiredCapability, best, ranked };
}

// ════════════════════════════════════════════════════════════════════════════
// DB-bound layer — candidate sourcing + persistence. Gated by FLEET_ORCH_ENABLED.
// ════════════════════════════════════════════════════════════════════════════

/** Latest telemetry snapshot per robot → position + battery for scoring. */
async function loadCandidatesFromDb(): Promise<AllocCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  const robotRows = await db.select().from(robots).where(eq(robots.isEnabled, true));
  if (robotRows.length === 0) return [];

  // Open-task counts per device (assigned/running) for queue length.
  const openTasks = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ["assigned", "running"]));
  const queueByDevice = new Map<number, number>();
  for (const t of openTasks) {
    if (t.assignedDeviceId != null) queueByDevice.set(t.assignedDeviceId, (queueByDevice.get(t.assignedDeviceId) ?? 0) + 1);
  }

  // doc 22 P3 — SINGLE batched "latest telemetry per robot" read (was N+1: one query
  // per candidate). Pull every candidate robot's telemetry in ONE query ordered by
  // timestamp DESC, then keep the first (= latest) row seen per robotId. This is one
  // round-trip and yields the identical per-robot latest snapshot the old loop did.
  const robotIds = robotRows.map((r) => r.id);
  const telRows = await db
    .select()
    .from(robotTelemetry)
    .where(inArray(robotTelemetry.robotId, robotIds))
    .orderBy(desc(robotTelemetry.timestamp)); // latest snapshots first (global order)
  const latestTelByRobot = new Map<number, (typeof telRows)[number]>();
  for (const tel of telRows) {
    // First occurrence per robotId is its latest row (rows are timestamp-DESC ordered).
    if (!latestTelByRobot.has(tel.robotId)) latestTelByRobot.set(tel.robotId, tel);
  }

  const candidates: AllocCandidate[] = [];
  for (const r of robotRows) {
    const tel = latestTelByRobot.get(r.id);
    const pose = (tel?.poseJson ?? null) as Record<string, unknown> | null;
    const position = extractPosition(pose);
    const batteryPct = extractBattery(pose);
    const mobile = r.kind === "agv";
    candidates.push({
      deviceId: r.id,
      deviceKind: "robot",
      capabilityClass: robotKindToCapabilityClass(r.kind),
      mobile,
      // Online if the registry status is not offline/estop and the robot is enabled.
      online: r.status !== "offline" && r.status !== "estop",
      position,
      batteryPct,
      queueLength: queueByDevice.get(r.id) ?? 0,
    });
  }
  return candidates;
}

/** Pull Cartesian {x,y} out of a robot pose JSON (robotDriver/VDA5050 shape). */
function extractPosition(pose: Record<string, unknown> | null): { x: number; y: number } | null {
  if (!pose) return null;
  const cart = pose.cartesian as { x?: number; y?: number } | undefined;
  if (cart && typeof cart.x === "number" && typeof cart.y === "number") return { x: cart.x, y: cart.y };
  return null;
}

/** Pull battery % out of pose JSON if a producer (e.g. VDA5050) surfaced it there. */
function extractBattery(pose: Record<string, unknown> | null): number | null {
  if (!pose) return null;
  const b = pose.battery as { charge?: number } | number | undefined;
  if (typeof b === "number") return b;
  if (b && typeof b.charge === "number") return b.charge;
  return null;
}

export interface AllocateResult {
  ok: boolean;
  enabled: boolean;
  assignedDeviceId?: number;
  decision?: AllocationDecision;
  message?: string;
}

/**
 * Allocate a PENDING task to the best device and persist the assignment.
 * No-op (enabled:false) unless FLEET_ORCH_ENABLED. Does NOT dispatch any command —
 * the assignment is consumed later by a FOE workflow / scheduler that routes
 * through the gated dispatcher.
 */
export async function allocateTask(taskId: number): Promise<AllocateResult> {
  if (!fleetOrchEnabled()) return { ok: false, enabled: false, message: "FLEET_ORCH_ENABLED off" };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, message: "db unavailable" };

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { ok: false, enabled: true, message: `task ${taskId} not found` };
  if (task.status !== "pending") return { ok: false, enabled: true, message: `task ${taskId} not pending (${task.status})` };

  const candidates = await loadCandidatesFromDb();
  const decision = scoreCandidates(taskToAllocInput(task), candidates);
  traceAllocation(`task-${taskId}`, decision); // doc 33 I1 (F6) decision-trace
  if (!decision.best) {
    console.log(`[Fleet] allocateTask ${taskId}: no eligible device`);
    return { ok: false, enabled: true, decision, message: "no eligible device" };
  }

  await db
    .update(tasks)
    .set({
      status: "assigned",
      assignedDeviceId: decision.best.deviceId,
      assignedDeviceKind: "robot",
      assignedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
  console.log(`[Fleet] task ${taskId} → device ${decision.best.deviceId} (score ${decision.best.score})`);
  // U1-a — publish task.assigned (fire-and-forget; never throws into the allocator).
  publishTaskEvent("assigned", {
    taskId,
    taskKey: task.taskKey,
    requiredCapability: task.requiredCapability,
    assignedDeviceId: decision.best.deviceId,
    robotId: decision.best.deviceId,
    status: "assigned",
    priority: task.priority,
    corporateCode: task.corporateCode,
    factoryId: task.factoryId,
  });
  return { ok: true, enabled: true, assignedDeviceId: decision.best.deviceId, decision };
}

function taskToAllocInput(task: Task): AllocTaskInput {
  return {
    requiredCapability: task.requiredCapability,
    priority: task.priority,
    // locationStart is a zone code, not a coordinate — no direct coordinate here in G1.
    startPosition: null,
  };
}

export interface RebalanceResult {
  ok: boolean;
  enabled: boolean;
  reassigned: number;
  unassigned: number;
  message?: string;
}

/**
 * REBALANCING — call when a device goes offline/failed mid-work. Its open
 * (assigned/running) tasks are returned to `pending` (retryCount bumped) and
 * re-allocated to another eligible device of the same capability. A task with no
 * alternative device stays pending (left for the next allocate pass).
 *
 * Exposed for the robot manager / a scheduler to invoke on a status change.
 */
export async function rebalanceDeviceTasks(deviceId: number, reason = "device_offline"): Promise<RebalanceResult> {
  if (!fleetOrchEnabled()) return { ok: false, enabled: false, reassigned: 0, unassigned: 0, message: "FLEET_ORCH_ENABLED off" };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, reassigned: 0, unassigned: 0, message: "db unavailable" };

  const open = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.assignedDeviceId, deviceId), inArray(tasks.status, ["assigned", "running"])));
  if (open.length === 0) return { ok: true, enabled: true, reassigned: 0, unassigned: 0 };

  // Release the failed device's claim: each task back to pending, retryCount bumped,
  // assignment dropped. Per-row so retryCount increments from each task's own value.
  for (const t of open) {
    await db
      .update(tasks)
      .set({
        status: "pending",
        assignedDeviceId: null,
        assignedDeviceKind: null,
        assignedAt: null,
        retryCount: t.retryCount + 1,
        lastError: reason,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, t.id));
    // U1-a — publish task.failed (the device dropped this task mid-work; it will be
    // re-queued below). Fire-and-forget; the re-allocation may then emit task.assigned.
    publishTaskEvent("failed", {
      taskId: t.id,
      taskKey: t.taskKey,
      requiredCapability: t.requiredCapability,
      assignedDeviceId: deviceId,
      robotId: deviceId,
      status: "failed",
      priority: t.priority,
      corporateCode: t.corporateCode,
      factoryId: t.factoryId,
      error: reason,
    });
  }

  // Re-allocate each (now pending) task to a DIFFERENT eligible device.
  let reassigned = 0;
  let unassigned = 0;
  for (const t of open) {
    const candidates = (await loadCandidatesFromDb()).filter((c) => c.deviceId !== deviceId);
    const decision = scoreCandidates(taskToAllocInput(t), candidates);
    traceAllocation(`task-${t.id}`, decision, `rebalance (${reason})`); // doc 33 I1 (F6)
    if (decision.best) {
      await db
        .update(tasks)
        .set({
          status: "assigned",
          assignedDeviceId: decision.best.deviceId,
          assignedDeviceKind: "robot",
          assignedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, t.id));
      reassigned++;
    } else {
      unassigned++;
    }
  }
  console.log(`[Fleet] rebalance device ${deviceId}: ${reassigned} reassigned, ${unassigned} left pending (${reason})`);
  return { ok: true, enabled: true, reassigned, unassigned };
}

export interface DrainResult {
  ok: boolean;
  enabled: boolean;
  scanned: number;
  assigned: number;
  message?: string;
}

/**
 * doc 22 P3 — PENDING-DRAIN sweep. Nothing else currently drains the `pending` queue:
 * a task can land in `pending` (order decomposition, a rebalance that found no peer at
 * the time, a manual insert) and sit there forever if no order.created event re-fires.
 * This re-attempts allocation for every currently-pending task, so once a device frees
 * up / comes online the stuck work is picked up.
 *
 * Reuses `allocateTask` per task (which is itself flag-gated + assigns STATE only, never
 * a device command). No-op (enabled:false) unless FLEET_ORCH_ENABLED. Bounded by
 * `limit` so a huge backlog can't monopolise a sweep tick.
 */
export async function drainPendingTasks(limit = 100): Promise<DrainResult> {
  if (!fleetOrchEnabled()) return { ok: false, enabled: false, scanned: 0, assigned: 0, message: "FLEET_ORCH_ENABLED off" };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, scanned: 0, assigned: 0, message: "db unavailable" };

  const pending = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "pending"))
    .orderBy(desc(tasks.priority)); // drain highest-priority stuck work first
  const slice = pending.slice(0, Math.max(0, limit));
  let assigned = 0;
  for (const t of slice) {
    const res = await allocateTask(t.id);
    if (res.ok && res.assignedDeviceId != null) assigned++;
  }
  if (assigned > 0) console.log(`[Fleet] pending-drain: ${assigned}/${slice.length} pending task(s) assigned`);
  return { ok: true, enabled: true, scanned: slice.length, assigned };
}

// ── pending-drain sweep timer (mirrors fleet charging / field-health sweeps) ──
let drainTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

/**
 * Start the periodic pending-drain sweep. NO-OP (logs why) unless FLEET_ORCH_ENABLED.
 * Unref'd (never blocks shutdown) + non-overlapping. Interval via FLEET_DRAIN_SWEEP_MS
 * (default 60s, min 10s). Self-gating: `drainPendingTasks` re-checks the flag each tick,
 * so flipping the flag off at runtime makes the sweep a no-op without a restart.
 */
export function startFleetRebalanceSweep(): void {
  if (drainTimer) return; // guard double-start
  if (!fleetOrchEnabled()) {
    console.log("[Fleet] pending-drain sweep NOT started (FLEET_ORCH_ENABLED off)");
    return;
  }
  const intervalMs = Math.max(10_000, Number(process.env.FLEET_DRAIN_SWEEP_MS ?? 60_000));
  drainTimer = setInterval(() => {
    if (draining) return; // no overlap
    draining = true;
    void drainPendingTasks()
      .catch((err) => console.error("[Fleet] pending-drain sweep error:", (err as Error)?.message ?? err))
      .finally(() => { draining = false; });
  }, intervalMs);
  if (typeof (drainTimer as any)?.unref === "function") (drainTimer as any).unref();
  console.log(`[Fleet] pending-drain sweep started (every ${intervalMs}ms)`);
}

/** Stop the pending-drain sweep (tests / shutdown). */
export function stopFleetRebalanceSweep(): void {
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  draining = false;
}

// ════════════════════════════════════════════════════════════════════════════
// G2 (doc 16 §7 part c / §15 G2) — Operation-aware REFINEMENT (ADDITIVE, flag-gated
// by FLEET_RESOURCE_ENABLED). This NEVER runs on the G1 path: scoreCandidates /
// allocateTask / rebalanceDeviceTasks above are byte-for-byte unchanged. The G2
// refinement is an OPT-IN extra filter the caller layers ON TOP of the G1 ranking.
// ════════════════════════════════════════════════════════════════════════════

/**
 * PURE — refine a G1 ranking using a resolved operation's required capability.
 * Returns the G1 decision UNCHANGED unless `operation` is supplied (G2 path). When
 * supplied, candidates whose capability class does not support the operation's
 * requiredCapability are demoted to ineligible (an EXTRA hard filter, never relaxing
 * G1's own capability gate). Candidate→capabilityClass is taken from the same input
 * the allocator already has; no DB access here.
 *
 * The allocator's own task.requiredCapability is still the primary gate; this simply
 * lets an operation registry add a second, operation-specific capability requirement
 * without rewriting the G1 scorer.
 */
export function refineByOperation(
  decision: AllocationDecision,
  candidates: AllocCandidate[],
  operation: { requiredCapability: string } | null | undefined,
): AllocationDecision {
  if (!operation) return decision;
  const classById = new Map(candidates.map((c) => [c.deviceId, c.capabilityClass]));
  const ranked = decision.ranked.map((r) => {
    if (!r.eligible) return r;
    const cls = classById.get(r.deviceId);
    if (cls && !hasCapability(cls, operation.requiredCapability)) {
      return { ...r, score: -Infinity, eligible: false, reasons: [...r.reasons, "operation_capability_mismatch"] };
    }
    return r;
  });
  ranked.sort((a, b) => b.score - a.score || a.deviceId - b.deviceId);
  const best = ranked.find((r) => r.eligible) ?? null;
  return { taskCapability: decision.taskCapability, best, ranked };
}
