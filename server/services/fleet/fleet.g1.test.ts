/**
 * G1 (doc 16 Khối 2) — Fleet & Task Orchestration tests.
 *
 * Two layers:
 *   • PURE: scoreCandidates (capability+battery+queue+distance+priority),
 *     detectDeadlockCycles, planPath stub — no DB, deterministic.
 *   • DB-FLOW (in-memory fake db keyed on the REAL drizzle column .name): idempotent
 *     task creation from order.created, rebalancing on device-offline, zone
 *     concurrency limit, reservation conflict rejection, flag-OFF no-ops.
 *
 * The fake db is self-contained (does NOT touch a real database) so these run in any
 * environment. We mock drizzle-orm's predicate helpers to capture column `.name`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── drizzle-orm predicate mock (captures real column .name) ──────────────────
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  inArray: (col: any, vals: any[]) => ({ __op: "inArray", __k: col?.name, __vals: vals }),
  desc: (col: any) => ({ __desc: col?.name }),
  asc: (col: any) => ({ __asc: col?.name }),
  sql: () => ({}),
}));

// ── in-memory tables (mirror the fleet schema by drizzle table .name) ────────
type Row = Record<string, any>;
const store: Record<string, Row[]> = { tasks: [], zones: [], robots: [], robot_telemetry: [], zone_reservations: [], production_orders: [] };
const seq: Record<string, number> = {};
function nextId(table: string): number { seq[table] = (seq[table] ?? 0) + 1; return seq[table]; }

function reset() {
  for (const k of Object.keys(store)) store[k] = [];
  for (const k of Object.keys(seq)) seq[k] = 0;
}

function tableName(t: any): string {
  // drizzle pgTable exposes its sql name via a Symbol; fall back to a tagged guess.
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "and") return pred.__ps.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "inArray") return pred.__vals.includes(row[pred.__k]);
  return true;
}

function makeFakeDb() {
  const select = () => ({
    from: (t: any) => {
      const name = tableName(t);
      let pred: any = null;
      let order: any = null;
      const q: any = {
        where: (p: any) => { pred = p; return q; },
        orderBy: (o: any) => { order = o; return q; },
        limit: async (n: number) => run().slice(0, n),
        for: (_s?: any, _c?: any) => q, // SELECT … FOR UPDATE (row lock) — no-op in the fake, still thenable
        then: (resolve: any) => resolve(run()),
      };
      function run(): Row[] {
        let rows = (store[name] ?? []).filter((r) => matches(r, pred));
        if (order?.__desc) rows = [...rows].sort((a, b) => (b[order.__desc] ?? 0) - (a[order.__desc] ?? 0));
        else if (order?.__asc) rows = [...rows].sort((a, b) => (a[order.__asc] ?? 0) - (b[order.__asc] ?? 0));
        return rows;
      }
      return q;
    },
  });
  const db: any = {
    select,
    insert: (t: any) => ({
      values: (vals: Row | Row[]) => {
        const name = tableName(t);
        const arr = Array.isArray(vals) ? vals : [vals];
        const inserted = arr.map((v) => { const row = { id: nextId(name), ...v }; store[name].push(row); return row; });
        const ret: any = { returning: async () => inserted };
        // also awaitable without returning()
        ret.then = (resolve: any) => resolve(inserted);
        return ret;
      },
    }),
    update: (t: any) => ({
      set: (vals: Row) => ({
        where: async (pred: any) => {
          const name = tableName(t);
          for (const r of (store[name] ?? []).filter((row) => matches(row, pred))) Object.assign(r, vals);
        },
      }),
    }),
  };
  // Reservation atomicity (P0): reserveZone/claimResource run inside db.transaction();
  // the fake runs the callback synchronously against the same in-memory store.
  db.transaction = async (cb: any) => cb(db);
  return db;
}

vi.mock("../../db/connection", () => ({ getDb: async () => makeFakeDb() }));

import {
  scoreCandidates,
  rebalanceDeviceTasks,
  allocateTask,
  _clearProfileCache,
  type AllocCandidate,
} from "./taskAllocator";
import { detectDeadlockCycles, planPath, reserveZone } from "./trafficManager";
import { decomposeOrderToTasks } from "./fleetOrchestrator";

beforeEach(() => {
  reset();
  _clearProfileCache();
  delete process.env.FLEET_ORCH_ENABLED;
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — scoring
// ════════════════════════════════════════════════════════════════════════════
describe("scoreCandidates (allocator)", () => {
  const base: AllocCandidate = {
    deviceId: 0, deviceKind: "robot", capabilityClass: "ROBOT", mobile: false, online: true, queueLength: 0,
  };

  it("excludes a device that lacks the required capability", () => {
    const cands: AllocCandidate[] = [
      { ...base, deviceId: 1, capabilityClass: "AOI" }, // AOI has no run_job verb
      { ...base, deviceId: 2, capabilityClass: "ROBOT" },
    ];
    const d = scoreCandidates({ requiredCapability: "run_job" }, cands);
    expect(d.best?.deviceId).toBe(2);
    expect(d.ranked.find((r) => r.deviceId === 1)?.eligible).toBe(false);
  });

  it("prefers shorter queue when capability ties", () => {
    const cands: AllocCandidate[] = [
      { ...base, deviceId: 1, queueLength: 3 },
      { ...base, deviceId: 2, queueLength: 0 },
    ];
    const d = scoreCandidates({ requiredCapability: "run_job" }, cands);
    expect(d.best?.deviceId).toBe(2);
  });

  it("prefers higher battery for mobile robots and excludes below the floor", () => {
    const cands: AllocCandidate[] = [
      { ...base, deviceId: 1, mobile: true, batteryPct: 15 }, // below 20% floor → excluded
      { ...base, deviceId: 2, mobile: true, batteryPct: 90 },
      { ...base, deviceId: 3, mobile: true, batteryPct: 55 },
    ];
    const d = scoreCandidates({ requiredCapability: "run_job" }, cands);
    expect(d.best?.deviceId).toBe(2);
    expect(d.ranked.find((r) => r.deviceId === 1)?.reasons).toContain("battery_too_low");
  });

  it("prefers the nearer device by position", () => {
    const cands: AllocCandidate[] = [
      { ...base, deviceId: 1, position: { x: 100, y: 0 } },
      { ...base, deviceId: 2, position: { x: 1, y: 0 } },
    ];
    const d = scoreCandidates({ requiredCapability: "run_job", startPosition: { x: 0, y: 0 } }, cands);
    expect(d.best?.deviceId).toBe(2);
  });

  it("returns no best when every candidate is offline", () => {
    const cands: AllocCandidate[] = [{ ...base, deviceId: 1, online: false }];
    const d = scoreCandidates({ requiredCapability: "run_job" }, cands);
    expect(d.best).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — deadlock + path stub
// ════════════════════════════════════════════════════════════════════════════
describe("detectDeadlockCycles", () => {
  it("detects a 2-device cycle (A waits B, B waits A)", () => {
    const cycles = detectDeadlockCycles([
      { device: 1, zone: 10, holders: [2] }, // dev1 queued on zone held by dev2
      { device: 2, zone: 11, holders: [1] }, // dev2 queued on zone held by dev1
    ]);
    expect(cycles.length).toBe(1);
    expect([...cycles[0]].sort()).toEqual([1, 2]);
  });

  it("reports no cycle for an acyclic wait-graph", () => {
    const cycles = detectDeadlockCycles([
      { device: 1, zone: 10, holders: [2] },
      { device: 2, zone: 11, holders: [3] },
    ]);
    expect(cycles).toEqual([]);
  });
});

describe("planPath stub", () => {
  it("returns waypoints verbatim and is honest about the limitation", () => {
    const p = planPath([1, 2, 3]);
    expect(p.zones).toEqual([1, 2, 3]);
    expect(p.note).toMatch(/no occupancy-grid map/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — order decomposition (idempotent)
// ════════════════════════════════════════════════════════════════════════════
describe("decomposeOrderToTasks (idempotent from order.created)", () => {
  it("creates exactly one task per order and is idempotent on replay", async () => {
    store.production_orders.push({ id: 7, orderCode: "WO-7", companyCode: "C1", factoryId: 1, priority: 4, productModelId: 3 });
    const first = await decomposeOrderToTasks(7);
    expect(first.created).toBe(1);
    const second = await decomposeOrderToTasks(7); // replay
    expect(second.created).toBe(0);
    expect(store.tasks.filter((t) => t.sourceWorkOrderId === 7).length).toBe(1);
    expect(store.tasks[0].requiredCapability).toBe("run_job");
    expect(store.tasks[0].priority).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — allocation + rebalancing + flag-off
// ════════════════════════════════════════════════════════════════════════════
describe("allocateTask + rebalanceDeviceTasks (flag-gated)", () => {
  function seedRobot(id: number, kind = "arm", status = "idle") {
    store.robots.push({ id, code: `R${id}`, kind, isEnabled: true, status });
  }

  it("flag OFF → allocate + rebalance are no-ops", async () => {
    seedRobot(1);
    store.tasks.push({ id: 1, taskKey: "t1", requiredCapability: "run_job", priority: 3, status: "pending" });
    const a = await allocateTask(1);
    expect(a.enabled).toBe(false);
    expect(store.tasks[0].status).toBe("pending");
    const r = await rebalanceDeviceTasks(1);
    expect(r.enabled).toBe(false);
  });

  it("flag ON → allocates a pending task to an eligible robot", async () => {
    process.env.FLEET_ORCH_ENABLED = "true";
    seedRobot(1);
    store.tasks.push({ id: 1, taskKey: "t1", requiredCapability: "run_job", priority: 3, status: "pending", retryCount: 0 });
    const a = await allocateTask(1);
    expect(a.ok).toBe(true);
    expect(a.assignedDeviceId).toBe(1);
    expect(store.tasks[0].status).toBe("assigned");
  });

  it("flag ON → rebalancing reassigns an offline robot's tasks to a peer", async () => {
    process.env.FLEET_ORCH_ENABLED = "true";
    seedRobot(1, "arm", "idle");
    seedRobot(2, "arm", "idle");
    // task currently on robot 1 (which is about to fail)
    store.tasks.push({ id: 1, taskKey: "t1", requiredCapability: "run_job", priority: 3, status: "running", assignedDeviceId: 1, retryCount: 0 });
    const r = await rebalanceDeviceTasks(1, "robot_estop");
    expect(r.reassigned).toBe(1);
    expect(store.tasks[0].assignedDeviceId).toBe(2);
    expect(store.tasks[0].status).toBe("assigned");
    expect(store.tasks[0].retryCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — zone concurrency + reservation conflict
// ════════════════════════════════════════════════════════════════════════════
describe("reserveZone (concurrency + conflict)", () => {
  beforeEach(() => { process.env.FLEET_ORCH_ENABLED = "true"; });

  it("enforces max_concurrent_robots: 2nd device into a cap-1 zone is queued", async () => {
    store.zones.push({ id: 10, code: "Z10", name: "Z", maxConcurrentRobots: 1 });
    const r1 = await reserveZone({ zoneId: 10, deviceId: 1 });
    expect(r1.status).toBe("active");
    const r2 = await reserveZone({ zoneId: 10, deviceId: 2 });
    expect(r2.status).toBe("queued");
  });

  it("rejects (not queues) when queueIfFull=false and zone is full", async () => {
    store.zones.push({ id: 11, code: "Z11", name: "Z", maxConcurrentRobots: 1 });
    await reserveZone({ zoneId: 11, deviceId: 1 });
    const r2 = await reserveZone({ zoneId: 11, deviceId: 2, queueIfFull: false });
    expect(r2.ok).toBe(false);
    expect(r2.status).toBe("rejected");
  });

  it("flag OFF → reserveZone is a no-op (rejected/disabled)", async () => {
    delete process.env.FLEET_ORCH_ENABLED;
    store.zones.push({ id: 12, code: "Z12", name: "Z", maxConcurrentRobots: 5 });
    const r = await reserveZone({ zoneId: 12, deviceId: 1 });
    expect(r.enabled).toBe(false);
    expect(store.zone_reservations.length).toBe(0);
  });
});
