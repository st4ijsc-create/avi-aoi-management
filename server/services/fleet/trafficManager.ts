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
import { zones, zoneReservations } from "../../../drizzle/schema";
import { fleetOrchEnabled } from "./taskAllocator";

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

  const [zone] = await db.select().from(zones).where(eq(zones.id, input.zoneId)).limit(1);
  if (!zone) return { ok: false, enabled: true, status: "rejected", message: `zone ${input.zoneId} not found` };

  // Idempotent re-entry: already holding an active claim → return it.
  const [existing] = await db
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
  if (existing) {
    const occupancy = await getZoneOccupancy(input.zoneId);
    return { ok: true, enabled: true, status: "active", reservationId: existing.id, occupancy, capacity: zone.maxConcurrentRobots };
  }

  const occupancy = await getZoneOccupancy(input.zoneId);
  const queueIfFull = input.queueIfFull ?? true;

  if (occupancy >= zone.maxConcurrentRobots) {
    // Zone full — virtual red light.
    if (!queueIfFull) {
      const [row] = await db
        .insert(zoneReservations)
        .values({ ...baseRes(input), status: "rejected" })
        .returning({ id: zoneReservations.id });
      return { ok: false, enabled: true, status: "rejected", reservationId: row?.id, occupancy, capacity: zone.maxConcurrentRobots, message: "zone at capacity" };
    }
    const [row] = await db
      .insert(zoneReservations)
      .values({ ...baseRes(input), status: "queued" })
      .returning({ id: zoneReservations.id });
    console.log(`[Fleet] zone ${input.zoneId} full (${occupancy}/${zone.maxConcurrentRobots}) → device ${input.deviceId} QUEUED`);
    return { ok: true, enabled: true, status: "queued", reservationId: row?.id, occupancy, capacity: zone.maxConcurrentRobots };
  }

  // Green light — grant.
  const [row] = await db
    .insert(zoneReservations)
    .values({ ...baseRes(input), status: "active" })
    .returning({ id: zoneReservations.id });
  return { ok: true, enabled: true, status: "active", reservationId: row?.id, occupancy: occupancy + 1, capacity: zone.maxConcurrentRobots };
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

  const held = await db
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

  const now = new Date();
  await db
    .update(zoneReservations)
    .set({ status: "released", releasedAt: now })
    .where(inArray(zoneReservations.id, held.map((h) => h.id)));

  // Promote the oldest queued waiter per freed zone (if capacity now allows).
  let promoted = 0;
  const freedZones = [...new Set(held.filter((h) => h.status === "active").map((h) => h.zoneId))];
  for (const zid of freedZones) {
    const [zone] = await db.select().from(zones).where(eq(zones.id, zid)).limit(1);
    if (!zone) continue;
    if ((await getZoneOccupancy(zid)) >= zone.maxConcurrentRobots) continue;
    const [next] = await db
      .select()
      .from(zoneReservations)
      .where(and(eq(zoneReservations.zoneId, zid), eq(zoneReservations.status, "queued")))
      .orderBy(zoneReservations.createdAt)
      .limit(1);
    if (next) {
      await db.update(zoneReservations).set({ status: "active" }).where(eq(zoneReservations.id, next.id));
      promoted++;
    }
  }
  console.log(`[Fleet] device ${deviceId} released ${held.length} reservation(s), promoted ${promoted} waiter(s)`);
  return { ok: true, enabled: true, released: held.length, promoted };
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
