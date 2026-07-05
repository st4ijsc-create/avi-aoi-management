/**
 * Khối 2 (doc 16 §7) — Zone + Traffic & Path Management.  Flag: FLEET_ORCH_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Reservation-based navigation over the `zones` / `zone_reservations` entities:
 *
 *   • RESERVE a zone before entering (claim a "segment"). Per-zone concurrency is
 *     enforced against zones.maxConcurrentRobots ("virtual traffic light"). When a
 *     zone is full, the request is either QUEUED (status='queued', backpressure) or
 *     REJECTED, per the caller's `queueIfFull` choice.
 *   • RELEASE a zone (or all of a device's reservations) when the device leaves /
 *     goes offline.
 *   • OCCUPANCY is DERIVED — counted from active reservations (no denormalized
 *     counter that can drift).
 *   • DEADLOCK DETECTION — builds a wait-graph from queued reservations (device →
 *     the device(s) holding the zone it waits on) and reports cycles. AVOIDANCE in
 *     G1 = report + a documented priority/re-route hook for the caller (the engine
 *     can cancel the lowest-priority waiter or pick an alternate zone).
 *
 * PATH PLANNING (honest limitation): G1 has NO real occupancy-grid / map. Path
 * planning is therefore zone-hierarchical at the reservation level only — a route
 * is modelled as an ORDERED LIST of zone codes the device reserves in turn. The
 * A-star/grid planner (`planPath` below) is an HONEST STUB that returns the
 * requested waypoint zones unchanged; it is the seam a real planner plugs into
 * once a map exists (see doc 16 §15 — deferred to a later phase / TWIN map work).
 *
 * SAFETY: pure orchestration STATE. No device control — movement is still issued by
 * the gated dispatcher; this manager only decides WHO may be in a zone WHEN.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { zones, zoneReservations, tasks } from "../../../drizzle/schema";
import { fleetOrchEnabled } from "./taskAllocator";
// Pure planner deps — static imports (no DB side-effects at module load). Used by the
// dynamic-obstacle planning seam below; the legacy planPath() stub keeps its lazy
// require() so the byte-for-byte G1 behaviour (no grid → no import) is unchanged.
import {
  planPathOnGrid,
  withDynamicObstacles,
  type OccupancyGrid,
  type Point2D,
  type DynamicObstacle,
} from "../twin/occupancyGrid";
import {
  planDStarLite,
  replan as replanDStarLite,
  type DStarLiteState,
  type CellChange,
} from "../twin/dstarLite";
import { overlaps } from "../traffic/spaceTimeReservation"; // doc 33 D2 (H4 §5.4.3): space-time aware occupancy

/** doc 33 D2 — is the space-time reservation model active? Default OFF → count-semaphore. */
function spaceTimeEnabled(): boolean {
  return process.env.TRAFFIC_SPACETIME === "true" || process.env.TRAFFIC_SPACETIME === "1";
}

/**
 * Count active reservations whose [reservedFrom, reservedUntil] window TIME-OVERLAPS the requested
 * window (± buffer). Unlike the raw count, two time-disjoint reservations do NOT both consume a
 * slot — the space-time view. A null end = open-ended (conflicts with any window).
 */
export function overlappingReservationCount(
  reqFromMs: number,
  reqUntilMs: number | null,
  rows: Array<{ deviceId: number; reservedFrom: Date | string; reservedUntil: Date | string | null }>,
  bufferMs = 1500,
): number {
  const req = { start: reqFromMs, end: reqUntilMs ?? Number.POSITIVE_INFINITY, robotId: "req" };
  return rows.filter((r) => {
    const other = {
      start: new Date(r.reservedFrom).getTime(),
      end: r.reservedUntil ? new Date(r.reservedUntil).getTime() : Number.POSITIVE_INFINITY,
      robotId: String(r.deviceId),
    };
    return overlaps(req, other, bufferMs);
  }).length;
}

export interface ReserveInput {
  zoneId: number;
  deviceId: number;
  deviceKind?: string;
  taskId?: number | null;
  reservedUntil?: Date | null;
  /** When the zone is at capacity: queue (default) or reject. */
  queueIfFull?: boolean;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface ReserveResult {
  ok: boolean;
  enabled: boolean;
  status: "active" | "queued" | "rejected";
  reservationId?: number;
  occupancy?: number;
  capacity?: number;
  message?: string;
  /** doc 33 D2 (H4) — time-overlapping occupancy when TRAFFIC_SPACETIME is on (advisory). */
  spaceTimeOccupancy?: number;
}

/** Count of ACTIVE reservations in a zone (derived occupancy). */
export async function getZoneOccupancy(zoneId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const active = await db
    .select()
    .from(zoneReservations)
    .where(and(eq(zoneReservations.zoneId, zoneId), eq(zoneReservations.status, "active")));
  return active.length;
}

/**
 * Reserve a zone for a device. Enforces maxConcurrentRobots. An existing ACTIVE
 * reservation for the same (zone, device) is returned idempotently (re-entry is a
 * no-op, not a second slot).
 */
export async function reserveZone(input: ReserveInput): Promise<ReserveResult> {
  if (!fleetOrchEnabled()) return { ok: false, enabled: false, status: "rejected", message: "FLEET_ORCH_ENABLED off" };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, status: "rejected", message: "db unavailable" };

  // ATOMIC (P0 — closes the TOCTOU over-fill race): serialize all reservers of THIS
  // zone on the zone row (SELECT … FOR UPDATE) inside one transaction, so the occupancy
  // count + capacity check + insert cannot interleave with a concurrent reserver. Two
  // concurrent reservers of the same zone now block on the zone-row lock and are ordered.
  return db.transaction(async (tx) => {
    const [zone] = await tx.select().from(zones).where(eq(zones.id, input.zoneId)).for("update");
    if (!zone) return { ok: false, enabled: true, status: "rejected", message: `zone ${input.zoneId} not found` };

    // Idempotent re-entry: already holding an active claim → return it.
    const [existing] = await tx
      .select()
      .from(zoneReservations)
      .where(
        and(
          eq(zoneReservations.zoneId, input.zoneId),
          eq(zoneReservations.deviceId, input.deviceId),
          eq(zoneReservations.status, "active"),
        ),
      )
      .limit(1);

    // Occupancy DERIVED from active reservations, counted inside the locked transaction.
    const activeRows = await tx
      .select()
      .from(zoneReservations)
      .where(and(eq(zoneReservations.zoneId, input.zoneId), eq(zoneReservations.status, "active")));
    const occupancy = activeRows.length;

    // doc 33 D2 (H4 §5.4.3) — space-time capacity: count only reservations whose window OVERLAPS
    // the requested [now, reservedUntil]. Time-disjoint reservations don't both consume a slot.
    // Flag OFF → effectiveOccupancy === raw count (unchanged count-semaphore behavior).
    const spaceTimeOccupancy = spaceTimeEnabled()
      ? overlappingReservationCount(Date.now(), input.reservedUntil ? input.reservedUntil.getTime() : null, activeRows)
      : occupancy;
    const effectiveOccupancy = spaceTimeEnabled() ? spaceTimeOccupancy : occupancy;

    if (existing) {
      return { ok: true, enabled: true, status: "active", reservationId: existing.id, occupancy, capacity: zone.maxConcurrentRobots, spaceTimeOccupancy };
    }

    const queueIfFull = input.queueIfFull ?? true;

    if (effectiveOccupancy >= zone.maxConcurrentRobots) {
      // Zone full — virtual red light.
      if (!queueIfFull) {
        const [row] = await tx
          .insert(zoneReservations)
          .values({ ...baseRes(input), status: "rejected" })
          .returning({ id: zoneReservations.id });
        return { ok: false, enabled: true, status: "rejected", reservationId: row?.id, occupancy, capacity: zone.maxConcurrentRobots, message: "zone at capacity", spaceTimeOccupancy };
      }
      const [row] = await tx
        .insert(zoneReservations)
        .values({ ...baseRes(input), status: "queued" })
        .returning({ id: zoneReservations.id });
      console.log(`[Fleet] zone ${input.zoneId} full (${occupancy}/${zone.maxConcurrentRobots}) → device ${input.deviceId} QUEUED`);
      return { ok: true, enabled: true, status: "queued", reservationId: row?.id, occupancy, capacity: zone.maxConcurrentRobots, spaceTimeOccupancy };
    }

    // Green light — grant.
    const [row] = await tx
      .insert(zoneReservations)
      .values({ ...baseRes(input), status: "active" })
      .returning({ id: zoneReservations.id });
    return { ok: true, enabled: true, status: "active", reservationId: row?.id, occupancy: occupancy + 1, capacity: zone.maxConcurrentRobots, spaceTimeOccupancy: spaceTimeEnabled() ? spaceTimeOccupancy + 1 : undefined };
  });
}

function baseRes(input: ReserveInput) {
  return {
    zoneId: input.zoneId,
    deviceId: input.deviceId,
    deviceKind: input.deviceKind ?? "robot",
    taskId: input.taskId ?? null,
    reservedUntil: input.reservedUntil ?? null,
    corporateCode: input.corporateCode ?? null,
    factoryId: input.factoryId ?? null,
  };
}

export interface ReleaseResult {
  ok: boolean;
  enabled: boolean;
  released: number;
  promoted: number;
}

/**
 * Release a device's reservation(s). If `zoneId` is given, release just that zone;
 * otherwise release ALL of the device's reservations (use on device-offline). After
 * releasing an ACTIVE slot, the oldest QUEUED waiter for that zone is PROMOTED to
 * active (deadlock-avoidance: queued waiters drain in FIFO when capacity frees).
 */
export async function releaseZone(deviceId: number, zoneId?: number): Promise<ReleaseResult> {
  if (!fleetOrchEnabled()) return { ok: false, enabled: false, released: 0, promoted: 0 };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, released: 0, promoted: 0 };

  // ATOMIC (W2-6 / doc 25 T5 — closes the release→promote race): the whole free +
  // FIFO promote runs in ONE transaction. For each freed zone we take the zone-row
  // FOR UPDATE lock BEFORE counting occupancy + promoting a waiter — the SAME lock
  // reserveZone holds — so a concurrent reserver cannot slip in and over-fill the
  // zone while we promote (and two releasers cannot both promote a waiter into the
  // same freed slot). freedZones are locked in ascending id order to avoid deadlock.
  return db.transaction(async (tx) => {
    const held = await tx
      .select()
      .from(zoneReservations)
      .where(
        and(
          eq(zoneReservations.deviceId, deviceId),
          inArray(zoneReservations.status, ["active", "queued"]),
          ...(zoneId != null ? [eq(zoneReservations.zoneId, zoneId)] : []),
        ),
      );
    if (held.length === 0) return { ok: true, enabled: true, released: 0, promoted: 0 };

    // Snapshot the zones whose ACTIVE slot we are about to free BEFORE the update
    // (the update mutates the held rows' status, so read it first).
    const freedZones = [...new Set(held.filter((h) => h.status === "active").map((h) => h.zoneId))].sort((a, b) => a - b);

    const now = new Date();
    await tx
      .update(zoneReservations)
      .set({ status: "released", releasedAt: now })
      .where(inArray(zoneReservations.id, held.map((h) => h.id)));

    // Promote the oldest queued waiter per freed zone (if capacity now allows).
    let promoted = 0;
    for (const zid of freedZones) {
      const [zone] = await tx.select().from(zones).where(eq(zones.id, zid)).for("update");
      if (!zone) continue;
      const activeRows = await tx
        .select()
        .from(zoneReservations)
        .where(and(eq(zoneReservations.zoneId, zid), eq(zoneReservations.status, "active")));
      if (activeRows.length >= zone.maxConcurrentRobots) continue;
      const [next] = await tx
        .select()
        .from(zoneReservations)
        .where(and(eq(zoneReservations.zoneId, zid), eq(zoneReservations.status, "queued")))
        .orderBy(zoneReservations.createdAt)
        .limit(1);
      if (next) {
        await tx.update(zoneReservations).set({ status: "active" }).where(eq(zoneReservations.id, next.id));
        promoted++;
      }
    }
    console.log(`[Fleet] device ${deviceId} released ${held.length} reservation(s), promoted ${promoted} waiter(s)`);
    return { ok: true, enabled: true, released: held.length, promoted };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// DEADLOCK DETECTION — cycle detection over the reservation wait-graph.
// ════════════════════════════════════════════════════════════════════════════

/** An edge: `device` (a queued waiter) waits on `zone`, currently held by `holders`. */
export interface WaitEdge {
  device: number;
  zone: number;
  holders: number[];
}

/**
 * PURE cycle detection. The wait-graph is device→device: a queued waiter on a zone
 * "waits on" every device holding an active slot in that zone. A cycle (A waits on
 * B, B waits on A, …) is a deadlock. Returns each cycle as a device-id list.
 */
export function detectDeadlockCycles(edges: WaitEdge[]): number[][] {
  // Build adjacency: waiter → holders (devices it is blocked by).
  const adj = new Map<number, Set<number>>();
  for (const e of edges) {
    if (!adj.has(e.device)) adj.set(e.device, new Set());
    for (const h of e.holders) if (h !== e.device) adj.get(e.device)!.add(h);
  }

  const cycles: number[][] = [];
  const seen = new Set<string>();
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<number, number>();
  const stack: number[] = [];

  const dfs = (u: number) => {
    color.set(u, GREY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GREY) {
        // Back-edge → cycle from v..u on the stack.
        const idx = stack.indexOf(v);
        if (idx >= 0) {
          const cycle = stack.slice(idx);
          const key = [...cycle].sort((a, b) => a - b).join(",");
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        }
      } else if (c === WHITE) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  };

  for (const node of adj.keys()) if ((color.get(node) ?? WHITE) === WHITE) dfs(node);
  return cycles;
}

/** Build the wait-graph from the DB and detect deadlocks (live check). */
export async function detectDeadlocks(): Promise<{ enabled: boolean; cycles: number[][] }> {
  if (!fleetOrchEnabled()) return { enabled: false, cycles: [] };
  const db = await getDb();
  if (!db) return { enabled: true, cycles: [] };

  const queued = await db.select().from(zoneReservations).where(eq(zoneReservations.status, "queued"));
  const active = await db.select().from(zoneReservations).where(eq(zoneReservations.status, "active"));
  const holdersByZone = new Map<number, number[]>();
  for (const a of active) {
    if (!holdersByZone.has(a.zoneId)) holdersByZone.set(a.zoneId, []);
    holdersByZone.get(a.zoneId)!.push(a.deviceId);
  }
  const edges: WaitEdge[] = queued.map((q) => ({ device: q.deviceId, zone: q.zoneId, holders: holdersByZone.get(q.zoneId) ?? [] }));
  return { enabled: true, cycles: detectDeadlockCycles(edges) };
}

// ════════════════════════════════════════════════════════════════════════════
// DEADLOCK RESOLUTION (W4-18 §5, ADVISORY) — detectDeadlocks() only REPORTS cycles.
// This is the documented priority/re-route hook: for each detected cycle it CANCELS
// (status='rejected') the single QUEUED reservation belonging to the LOWEST-PRIORITY
// waiter in that cycle, breaking the wait edge so the remaining devices can proceed.
//
// Priority is taken from the waiter's task (tasks.priority, higher number = more
// important per the allocator's W_PRIORITY weight). A queued reservation with no task
// is treated as priority 0 (least important → cancelled first). SAFETY: writes
// reservation STATE only — no device command. No-op unless FLEET_ORCH_ENABLED.
// ════════════════════════════════════════════════════════════════════════════

export interface DeadlockAction {
  cycle: number[];
  cancelledDevice: number;
  zoneId: number;
  reservationId: number;
  priority: number;
  reason: string;
}

export interface ResolveDeadlockResult {
  ok: boolean;
  enabled: boolean;
  cyclesFound: number;
  resolved: number;
  actions: DeadlockAction[];
}

/** Advisory resolver — break each deadlock cycle by cancelling its lowest-priority waiter. */
export async function resolveDeadlock(): Promise<ResolveDeadlockResult> {
  if (!fleetOrchEnabled()) return { ok: false, enabled: false, cyclesFound: 0, resolved: 0, actions: [] };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, cyclesFound: 0, resolved: 0, actions: [] };

  const { cycles } = await detectDeadlocks();
  if (cycles.length === 0) return { ok: true, enabled: true, cyclesFound: 0, resolved: 0, actions: [] };

  // Snapshot every queued reservation + resolve each waiter's task priority.
  const queued = await db.select().from(zoneReservations).where(eq(zoneReservations.status, "queued"));
  const taskIds = [...new Set(queued.map((q) => q.taskId).filter((x): x is number => x != null))];
  const priorityByTask = new Map<number, number>();
  if (taskIds.length) {
    const trows = await db.select().from(tasks).where(inArray(tasks.id, taskIds));
    for (const tr of trows) priorityByTask.set(tr.id, tr.priority);
  }
  const priorityOf = (r: (typeof queued)[number]): number => (r.taskId != null ? (priorityByTask.get(r.taskId) ?? 0) : 0);

  const actions: DeadlockAction[] = [];
  const cancelledIds = new Set<number>();
  const now = new Date();
  for (const cycle of cycles) {
    const inCycle = new Set(cycle);
    // Waiters in THIS cycle that are still queued (not already cancelled for a prior cycle).
    const candidates = queued.filter((q) => inCycle.has(q.deviceId) && !cancelledIds.has(q.id));
    if (candidates.length === 0) continue;
    // Lowest priority first; tie-break on lowest deviceId for determinism.
    candidates.sort((a, b) => priorityOf(a) - priorityOf(b) || a.deviceId - b.deviceId);
    const victim = candidates[0];
    const pri = priorityOf(victim);
    await db
      .update(zoneReservations)
      .set({ status: "rejected", releasedAt: now })
      .where(eq(zoneReservations.id, victim.id));
    cancelledIds.add(victim.id);
    actions.push({
      cycle,
      cancelledDevice: victim.deviceId,
      zoneId: victim.zoneId,
      reservationId: victim.id,
      priority: pri,
      reason: `lowest-priority waiter (device ${victim.deviceId}, P${pri}) cancelled to break deadlock`,
    });
  }
  console.log(`[Fleet] resolveDeadlock: ${cycles.length} cycle(s), cancelled ${actions.length} waiter(s)`);
  return { ok: true, enabled: true, cyclesFound: cycles.length, resolved: actions.length, actions };
}

/**
 * PATH PLANNING (G1 stub + T1 grid seam).
 *
 * G1 had NO occupancy-grid map, so the default behaviour returns the requested zone
 * waypoints unchanged (reservation-level routing). T1 (doc 16 §15) adds a REAL A*
 * grid planner in server/services/twin/occupancyGrid.ts. This function stays the
 * stub UNLESS the caller passes an occupancy grid AND world-space start/goal points
 * — then it delegates to planPathOnGrid() and returns the real cell route. This is
 * additive: callers (and the G1 tests) that call planPath([1,2,3]) with no grid get
 * the byte-for-byte unchanged stub result.
 */
export function planPath(
  zoneWaypoints: number[],
  gridRoute?: {
    grid: import("../twin/occupancyGrid").OccupancyGrid;
    from: import("../twin/occupancyGrid").Point2D;
    to: import("../twin/occupancyGrid").Point2D;
  },
): { ok: boolean; zones: number[]; note: string; gridPath?: import("../twin/occupancyGrid").Point2D[] } {
  if (gridRoute) {
    // T1 — back the seam with the real A* grid planner (lazy import; pure call).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { planPathOnGrid } = require("../twin/occupancyGrid") as typeof import("../twin/occupancyGrid");
    const r = planPathOnGrid(gridRoute.grid, gridRoute.from, gridRoute.to);
    return {
      ok: r.ok,
      zones: zoneWaypoints,
      note: r.ok ? `A* grid route: ${r.cells.length} cells (${r.expanded} expanded)` : `A* failed: ${r.reason}`,
      gridPath: r.path,
    };
  }
  return {
    ok: true,
    zones: zoneWaypoints,
    note: "stub: no occupancy-grid map supplied — waypoints returned verbatim (reservation-level routing only)",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DYNAMIC-OBSTACLE-AWARE PLANNING (T1-e, doc 16 §15) — layer OTHER robots' live
// positions onto the static grid and plan with D* Lite so a route avoids them; replan
// INCREMENTALLY when an obstacle appears/moves. PURE helpers here are unflagged +
// testable; the DB/live entry points are gated on FLEET_ORCH_ENABLED (no-op when off),
// mirroring reserveZone / allocateTask.
//
// HONEST SCOPE: grid-level D* Lite with robots as blocked cells — NOT continuous /
// kinodynamic planning. Decides a ROUTE for presentation/orchestration; commands no
// device (dispatch stays with the gated dispatcher).
// ════════════════════════════════════════════════════════════════════════════

/**
 * PURE dynamic planner. Folds `dynamicObstacles` (other robots' world positions, with
 * an optional inflation radius) onto `grid`, then plans `from`→`to`:
 *   • with dynamics → D* Lite (returns the reusable search `state` for incremental
 *     replanning via replanOnObstacleChange);
 *   • no dynamics → falls back to the static A* (planPathOnGrid), matching planPath.
 *
 * The returned `state` (present only on the D* Lite path) is what makes the follow-up
 * `replanOnObstacleChange` incremental rather than a from-scratch re-plan.
 */
export function planPathDynamic(
  grid: OccupancyGrid,
  from: Point2D,
  to: Point2D,
  dynamicObstacles: DynamicObstacle[] = [],
): {
  ok: boolean;
  path: Point2D[];
  cells: Array<{ col: number; row: number }>;
  cost?: number;
  expanded: number;
  planner: "dstar_lite" | "astar";
  note: string;
  state?: DStarLiteState;
  reason?: string;
} {
  if (dynamicObstacles.length === 0) {
    // No live obstacles → static A* (identical cost model; cheaper, no reuse needed).
    const r = planPathOnGrid(grid, from, to);
    return {
      ok: r.ok,
      path: r.path,
      cells: r.cells,
      expanded: r.expanded,
      planner: "astar",
      note: r.ok ? `A* static route: ${r.cells.length} cells (${r.expanded} expanded)` : `A* failed: ${r.reason}`,
      reason: r.ok ? undefined : r.reason,
    };
  }

  const dynGrid = withDynamicObstacles(grid, dynamicObstacles);
  const r = planDStarLite(dynGrid, from, to);
  return {
    ok: r.ok,
    path: r.path,
    cells: r.cells,
    cost: r.cost,
    expanded: r.expanded,
    planner: "dstar_lite",
    note: r.ok
      ? `D* Lite route around ${dynamicObstacles.length} dynamic obstacle(s): ${r.cells.length} cells, cost ${r.cost.toFixed(2)} (${r.expanded} expanded)`
      : `D* Lite failed: ${r.reason}`,
    state: r.state,
    reason: r.ok ? undefined : r.reason,
  };
}

/**
 * PURE incremental replan. Given a D* Lite `state` from a prior planPathDynamic() call
 * and the CHANGED cells (obstacle appeared/cleared, expressed in cell coords), reuses
 * the prior search to find the new route — the whole point of D* over re-running A*.
 * `newStart` optionally advances the robot's current cell (applies the km offset).
 */
export function replanOnObstacleChange(
  state: DStarLiteState,
  changedCells: CellChange[],
  opts?: { newStart?: { col: number; row: number } },
): {
  ok: boolean;
  path: Point2D[];
  cells: Array<{ col: number; row: number }>;
  cost?: number;
  expanded: number;
  note: string;
  reason?: string;
} {
  const r = replanDStarLite(state, changedCells, opts);
  return {
    ok: r.ok,
    path: r.path,
    cells: r.cells,
    cost: r.cost,
    expanded: r.expanded,
    note: r.ok
      ? `D* Lite incremental replan: ${r.cells.length} cells, cost ${r.cost.toFixed(2)} (${r.expanded} re-expanded)`
      : `D* Lite replan failed: ${r.reason}`,
    reason: r.ok ? undefined : r.reason,
  };
}

export interface LivePlanResult {
  ok: boolean;
  enabled: boolean;
  path?: Point2D[];
  cells?: Array<{ col: number; row: number }>;
  planner?: "dstar_lite" | "astar";
  obstacleCount?: number;
  note: string;
  /** Reusable D* Lite state (D* path only) for a follow-up replan. */
  state?: DStarLiteState;
}

/**
 * LIVE entry point — build the factory grid, fold in OTHER robots' live positions as
 * dynamic obstacles, and plan `from`→`to` (D* Lite when there are dynamics, else A*).
 * No-op (enabled:false) unless FLEET_ORCH_ENABLED, mirroring reserveZone/allocateTask.
 *
 * `excludeDeviceId` drops the planning robot's own pose from the obstacle set so it
 * doesn't block itself. `obstacleRadius` inflates each robot to a disc of cells.
 */
export async function planPathDynamicLive(
  from: Point2D,
  to: Point2D,
  opts?: { factoryId?: number; excludeDeviceId?: number; obstacleRadius?: number },
): Promise<LivePlanResult> {
  if (!fleetOrchEnabled()) return { ok: false, enabled: false, note: "FLEET_ORCH_ENABLED off" };

  const { buildFactoryGrid } = await import("../twin/occupancyGrid");
  const built = await buildFactoryGrid({ factoryId: opts?.factoryId });
  if (!built.grid) return { ok: false, enabled: true, note: `no grid: ${built.note}` };

  const obstacles = await loadRobotObstacles(opts?.excludeDeviceId, opts?.obstacleRadius);
  const r = planPathDynamic(built.grid, from, to, obstacles);
  return {
    ok: r.ok,
    enabled: true,
    path: r.path,
    cells: r.cells,
    planner: r.planner,
    obstacleCount: obstacles.length,
    note: `${built.note} | ${r.note}`,
    state: r.state,
  };
}

/**
 * Load OTHER robots' current world positions from their latest telemetry as dynamic
 * obstacles. Best-effort + degrade-safe (empty list when no db / no poses). Excludes
 * the planning robot (excludeDeviceId) so it does not treat itself as an obstacle.
 */
async function loadRobotObstacles(
  excludeDeviceId?: number,
  obstacleRadius?: number,
): Promise<DynamicObstacle[]> {
  const db = await getDb();
  if (!db) return [];
  const { robots, robotTelemetry } = await import("../../../drizzle/schema");
  const { desc } = await import("drizzle-orm");

  const robotRows = await db.select().from(robots).where(eq(robots.isEnabled, true));
  if (robotRows.length === 0) return [];
  const ids = robotRows.map((r) => r.id).filter((id) => id !== excludeDeviceId);
  if (ids.length === 0) return [];

  const telRows = await db
    .select()
    .from(robotTelemetry)
    .where(inArray(robotTelemetry.robotId, ids))
    .orderBy(desc(robotTelemetry.timestamp));
  const latestByRobot = new Map<number, (typeof telRows)[number]>();
  for (const tel of telRows) if (!latestByRobot.has(tel.robotId)) latestByRobot.set(tel.robotId, tel);

  const obstacles: DynamicObstacle[] = [];
  for (const [robotId, tel] of latestByRobot) {
    const pose = (tel?.poseJson ?? null) as Record<string, unknown> | null;
    const cart = pose?.cartesian as { x?: number; y?: number } | undefined;
    if (cart && typeof cart.x === "number" && typeof cart.y === "number") {
      obstacles.push({ id: robotId, point: { x: cart.x, y: cart.y }, radius: obstacleRadius });
    }
  }
  return obstacles;
}
