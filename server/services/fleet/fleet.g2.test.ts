/**
 * G2 (doc 16 Khối 2 c&d) — Skill/Operation registry, A/B variants, shared resources,
 * predictive charging tests. Flag: FLEET_RESOURCE_ENABLED.
 *
 * Two layers (mirrors fleet.g1.test.ts):
 *   • PURE: pickVariant (weighted + deterministic by seed), foldOutcome,
 *     projectChargeNeed, refineByOperation, operatorMeetsSkills — no DB.
 *   • DB-FLOW (same in-memory fake db, keyed on the REAL drizzle column .name):
 *     resource claim/conflict/queue/release+promote, charging plan scheduled when
 *     projected battery < floor, operation resolution → capability+skills+programs,
 *     flag-off → new mutating paths are no-ops/blocked.
 *
 * The fake db is self-contained (no real database).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── drizzle-orm predicate mock (captures real column .name) ──────────────────
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  or: (...ps: any[]) => ({ __op: "or", __ps: ps.filter(Boolean) }),
  inArray: (col: any, vals: any[]) => ({ __op: "inArray", __k: col?.name, __vals: vals }),
  isNull: (col: any) => ({ __op: "isNull", __k: col?.name }),
  gt: (col: any, val: any) => ({ __op: "gt", __k: col?.name, __v: val }),
  desc: (col: any) => ({ __desc: col?.name }),
  asc: (col: any) => ({ __asc: col?.name }),
  sql: () => ({}),
}));

// ── in-memory tables (mirror the schema by drizzle table .name) ──────────────
type Row = Record<string, any>;
const store: Record<string, Row[]> = {
  operation_codes: [],
  operation_program_map: [],
  program_projects: [],
  program_variants: [],
  shared_resources: [],
  resource_reservations: [],
  charger_stations: [],
  battery_charging_plans: [],
  user_certifications: [],
  tasks: [],
  robots: [],
  robot_telemetry: [],
};
const seq: Record<string, number> = {};
function nextId(table: string): number { seq[table] = (seq[table] ?? 0) + 1; return seq[table]; }
// W2-6: counts db.transaction() invocations (atomicity assertions).
let txCount = 0;

function reset() {
  for (const k of Object.keys(store)) store[k] = [];
  for (const k of Object.keys(seq)) seq[k] = 0;
  txCount = 0;
}

function tableName(t: any): string {
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "and") return pred.__ps.every((p: any) => matches(row, p));
  if (pred.__op === "or") return pred.__ps.some((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "inArray") return pred.__vals.includes(row[pred.__k]);
  if (pred.__op === "isNull") return row[pred.__k] == null;
  if (pred.__op === "gt") return row[pred.__k] != null && row[pred.__k] > pred.__v;
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
  // Reservation atomicity (P0) + release→promote atomicity (W2-6): claimResource /
  // releaseResource run inside db.transaction(); the fake runs the callback synchronously
  // against the same in-memory store and counts invocations for the atomicity assertions.
  db.transaction = async (cb: any) => { txCount++; return cb(db); };
  return db;
}

vi.mock("../../db/connection", () => ({ getDb: async () => makeFakeDb() }));

import { pickVariant, seedToUnit, foldOutcome, recordVariantOutcome, pickVariantForProgram } from "./variantPicker";
import { projectChargeNeed, sweepChargingPlans } from "./chargingPlanner";
import { resolveOperation, operatorMeetsSkills, deviceSupportsCapability } from "./skillRegistry";
import { claimResource, releaseResource, getResourceAvailability } from "./resourceManager";
import { refineByOperation, scoreCandidates, type AllocCandidate } from "./taskAllocator";

beforeEach(() => {
  reset();
  delete process.env.FLEET_RESOURCE_ENABLED;
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — A/B variant pick (weighted + deterministic)
// ════════════════════════════════════════════════════════════════════════════
describe("pickVariant (weighted, deterministic by seed)", () => {
  const arms = [
    { id: 1, variant: "A", trafficSplitPct: 80, status: "active" },
    { id: 2, variant: "B", trafficSplitPct: 20, status: "active" },
  ];

  it("is deterministic for the same seed", () => {
    const a = pickVariant(arms, "task-123");
    const b = pickVariant(arms, "task-123");
    expect(a).toEqual(b);
  });

  it("respects the traffic split distribution over many seeds (~80/20)", () => {
    let aCount = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (pickVariant(arms, `seed-${i}`)?.variant === "A") aCount++;
    const aPct = (aCount / N) * 100;
    expect(aPct).toBeGreaterThan(70); // ~80 with tolerance
    expect(aPct).toBeLessThan(90);
  });

  it("excludes paused arms and returns null when none active", () => {
    const paused = arms.map((a) => ({ ...a, status: "paused" }));
    expect(pickVariant(paused, "x")).toBeNull();
  });

  it("seedToUnit is in [0,1) and stable", () => {
    const u = seedToUnit("abc");
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
    expect(seedToUnit("abc")).toBe(u);
  });

  it("falls back to even split when all weights are 0", () => {
    const zero = arms.map((a) => ({ ...a, trafficSplitPct: 0 }));
    expect(pickVariant(zero, "anything")).not.toBeNull();
  });
});

describe("foldOutcome (rolling metrics)", () => {
  it("accumulates runs/successes/failures and averages cycle", () => {
    let m = foldOutcome(null, { success: true, cycleMs: 100 });
    m = foldOutcome(m, { success: false, cycleMs: 200 });
    expect(m.runs).toBe(2);
    expect(m.successes).toBe(1);
    expect(m.failures).toBe(1);
    expect(m.avgCycleMs).toBe(150);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — predictive charging projection
// ════════════════════════════════════════════════════════════════════════════
describe("projectChargeNeed", () => {
  it("schedules a charge when projected battery would dip below the floor", () => {
    // 40% − 4 tasks × 8% = 8% < 20% floor → needsCharge
    const n = projectChargeNeed(40, 4, { energyPerTaskPct: 8, floorPct: 20, chargeRatePctPerMin: 1.5, targetPct: 90 });
    expect(n.needsCharge).toBe(true);
    expect(n.projectedPct).toBe(8);
    expect(n.estimatedDurationMs).toBeGreaterThan(0);
  });

  it("does NOT schedule when the queue keeps battery above the floor", () => {
    const n = projectChargeNeed(90, 2, { energyPerTaskPct: 8, floorPct: 20 });
    expect(n.needsCharge).toBe(false);
    expect(n.estimatedDurationMs).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — skill matching + operation-aware refinement
// ════════════════════════════════════════════════════════════════════════════
describe("operatorMeetsSkills / deviceSupportsCapability / refineByOperation", () => {
  it("operatorMeetsSkills requires every skill", () => {
    expect(operatorMeetsSkills([1, 2, 3], [1, 2])).toBe(true);
    expect(operatorMeetsSkills([1], [1, 2])).toBe(false);
    expect(operatorMeetsSkills([], [])).toBe(true);
  });

  it("deviceSupportsCapability honours the capabilityModel verb set", () => {
    expect(deviceSupportsCapability("ROBOT", "run_job")).toBe(true);
    expect(deviceSupportsCapability("AOI", "run_job")).toBe(false);
  });

  it("refineByOperation adds an EXTRA hard filter without touching the G1 ranking when no op", () => {
    const cands: AllocCandidate[] = [
      { deviceId: 1, deviceKind: "robot", capabilityClass: "ROBOT", mobile: false, online: true, queueLength: 0 },
      { deviceId: 2, deviceKind: "robot", capabilityClass: "AOI", mobile: false, online: true, queueLength: 0 },
    ];
    const g1 = scoreCandidates({ requiredCapability: "select_recipe" }, cands);
    // No operation → unchanged.
    expect(refineByOperation(g1, cands, null)).toEqual(g1);
    // With an operation requiring run_job, the AOI candidate (no run_job) is demoted.
    const refined = refineByOperation(g1, cands, { requiredCapability: "run_job" });
    expect(refined.ranked.find((r) => r.deviceId === 2)?.eligible).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — operation resolution
// ════════════════════════════════════════════════════════════════════════════
describe("resolveOperation (capability + skills + qualified programs)", () => {
  it("resolves capability, skill ids, and compatible programs (deviceKind-filtered)", async () => {
    store.operation_codes.push({ id: 1, code: "OP-WELD", requiredCapability: "run_job", requiredSkillIds: [5, 6], toolType: "gripper", estimatedCycleMs: 12000 });
    store.program_projects.push({ id: 10, code: "PRG-A", name: "Weld A" });
    store.program_projects.push({ id: 11, code: "PRG-B", name: "Weld B" });
    store.operation_program_map.push({ id: 1, operationCodeId: 1, programProjectId: 10, deviceKind: "arm", compatible: true });
    store.operation_program_map.push({ id: 2, operationCodeId: 1, programProjectId: 11, deviceKind: "scara", compatible: true });
    store.operation_program_map.push({ id: 3, operationCodeId: 1, programProjectId: 99, deviceKind: "arm", compatible: false }); // excluded

    const r = await resolveOperation("OP-WELD", "arm");
    expect(r?.requiredCapability).toBe("run_job");
    expect(r?.requiredSkillIds).toEqual([5, 6]);
    expect(r?.qualifiedPrograms.map((p) => p.programProjectId)).toEqual([10]); // only arm + compatible
  });

  it("returns null for an unknown operation", async () => {
    expect(await resolveOperation("NOPE")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — shared resource claim / conflict / release + promote
// ════════════════════════════════════════════════════════════════════════════
describe("resourceManager claim/conflict/release+promote (flag-gated)", () => {
  function seedResource(id: number) {
    store.shared_resources.push({ id, code: `RES${id}`, type: "gripper", status: "available", currentOwnerDeviceId: null });
  }

  it("flag OFF → claim/release are no-ops", async () => {
    seedResource(1);
    const c = await claimResource({ resourceId: 1, deviceId: 1 });
    expect(c.enabled).toBe(false);
    expect(store.resource_reservations.length).toBe(0);
    const r = await releaseResource(1);
    expect(r.enabled).toBe(false);
  });

  it("flag ON → first device claims (active), second is queued, release promotes the waiter", async () => {
    process.env.FLEET_RESOURCE_ENABLED = "true";
    seedResource(1);

    const c1 = await claimResource({ resourceId: 1, deviceId: 1 });
    expect(c1.status).toBe("active");
    expect(store.shared_resources[0].currentOwnerDeviceId).toBe(1);

    const c2 = await claimResource({ resourceId: 1, deviceId: 2 });
    expect(c2.status).toBe("queued");

    const avail = await getResourceAvailability(1);
    expect(avail?.available).toBe(false);
    expect(avail?.activeCount).toBe(1);
    expect(avail?.queuedCount).toBe(1);

    txCount = 0;
    const rel = await releaseResource(1, 1);
    expect(txCount).toBe(1); // W2-6: free + promote wrapped in a single transaction
    expect(rel.released).toBe(1);
    expect(rel.promoted).toBe(1);
    expect(store.shared_resources[0].currentOwnerDeviceId).toBe(2); // waiter is new owner
    // single-owner invariant: exactly one active reservation on the resource.
    expect(store.resource_reservations.filter((r) => r.resourceId === 1 && r.status === "active")).toHaveLength(1);
  });

  it("flag ON → rejects (not queues) when queueIfFull=false and resource in use", async () => {
    process.env.FLEET_RESOURCE_ENABLED = "true";
    seedResource(2);
    await claimResource({ resourceId: 2, deviceId: 1 });
    const c2 = await claimResource({ resourceId: 2, deviceId: 2, queueIfFull: false });
    expect(c2.ok).toBe(false);
    expect(c2.status).toBe("rejected");
  });

  it("flag ON → re-claim by the same holder is idempotent (no 2nd active row)", async () => {
    process.env.FLEET_RESOURCE_ENABLED = "true";
    seedResource(3);
    const a = await claimResource({ resourceId: 3, deviceId: 1 });
    const b = await claimResource({ resourceId: 3, deviceId: 1 });
    expect(b.reservationId).toBe(a.reservationId);
    expect(store.resource_reservations.filter((r) => r.status === "active").length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — charging plan scheduling
// ════════════════════════════════════════════════════════════════════════════
describe("sweepChargingPlans (flag-gated)", () => {
  function seedAgv(id: number, batteryPct: number) {
    store.robots.push({ id, code: `AGV${id}`, kind: "agv", isEnabled: true, status: "idle" });
    store.robot_telemetry.push({ id: nextId("robot_telemetry"), robotId: id, timestamp: Date.now(), poseJson: { battery: { charge: batteryPct } } });
  }

  it("flag OFF → sweep is a no-op", async () => {
    seedAgv(1, 30);
    const r = await sweepChargingPlans();
    expect(r.enabled).toBe(false);
    expect(store.battery_charging_plans.length).toBe(0);
  });

  it("flag ON → schedules a plan when projected battery < floor", async () => {
    process.env.FLEET_RESOURCE_ENABLED = "true";
    seedAgv(1, 40);
    // 4 open tasks on the AGV → 40 − 4×8 = 8% < 20% floor.
    for (let i = 0; i < 4; i++) store.tasks.push({ id: nextId("tasks"), status: "assigned", assignedDeviceId: 1 });
    const r = await sweepChargingPlans();
    expect(r.scheduled).toBe(1);
    expect(store.battery_charging_plans[0].deviceId).toBe(1);
    expect(store.battery_charging_plans[0].status).toBe("planned");
  });

  it("flag ON → does NOT schedule when battery is healthy, and is idempotent on an open plan", async () => {
    process.env.FLEET_RESOURCE_ENABLED = "true";
    seedAgv(1, 95); // no queue → stays above floor
    const r1 = await sweepChargingPlans();
    expect(r1.scheduled).toBe(0);

    // Now a low AGV with an already-open plan → not double-scheduled.
    seedAgv(2, 10);
    store.battery_charging_plans.push({ id: nextId("battery_charging_plans"), deviceId: 2, status: "planned" });
    const r2 = await sweepChargingPlans();
    expect(r2.scheduled).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — flag-off blocks the variant/metrics DB paths
// ════════════════════════════════════════════════════════════════════════════
describe("variant DB paths flag-gated", () => {
  it("flag OFF → pickVariantForProgram + recordVariantOutcome are no-ops", async () => {
    store.program_variants.push({ id: 1, programProjectId: 7, variant: "A", trafficSplitPct: 100, status: "active", metrics: null });
    const p = await pickVariantForProgram(7, "seed");
    expect(p.enabled).toBe(false);
    const rec = await recordVariantOutcome(1, { success: true });
    expect(rec.enabled).toBe(false);
    expect(store.program_variants[0].metrics).toBeNull();
  });

  it("flag ON → pickVariantForProgram returns the only active arm + outcome folds into metrics", async () => {
    process.env.FLEET_RESOURCE_ENABLED = "true";
    store.program_variants.push({ id: 1, programProjectId: 7, variant: "A", trafficSplitPct: 100, status: "active", metrics: null });
    const p = await pickVariantForProgram(7, "seed");
    expect(p.picked?.variant).toBe("A");
    await recordVariantOutcome(1, { success: true, cycleMs: 50 });
    expect(store.program_variants[0].metrics.runs).toBe(1);
  });
});
