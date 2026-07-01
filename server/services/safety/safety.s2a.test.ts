/**
 * S2a (doc 20 §2/§5) — Safety-zone geometry + 3-level intrusion evaluator tests.
 *
 * Layers:
 *   • PURE: distance3 / distanceToAabb / pointInAabb / pointInPolygon /
 *     levelForDistance / evaluateZones — none/speed_reduce/stop/rated_stop at the
 *     right distances for AABB + polygon zones; multi-human nearest; multi-robot
 *     independent.
 *   • SERVICE (in-memory fake db): evaluateAndRecord records advisory events + attaches
 *     a gate PROPOSAL for speed_reduce/stop and LOGS rated_stop WITHOUT actuating;
 *     flag-off no-op. record()'s socket emit + gate flags mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ════════════════════════════════════════════════════════════════════════════
// PURE — no mocks needed
// ════════════════════════════════════════════════════════════════════════════
import {
  distance3,
  distanceToAabb,
  pointInAabb,
  pointInPolygon,
  humanInZoneFootprint,
  levelForDistance,
  evaluateZones,
  type SafetyZoneSpec,
  type HumanPos,
  type RobotPos,
} from "./zoneIntrusionEvaluator";

const ZONE: SafetyZoneSpec = {
  id: 1,
  speedReduceDistanceMm: 2000,
  stopDistanceMm: 1000,
  ratedStopDistanceMm: 500,
  reactionSpeedPct: 30,
};

describe("geometry helpers (PURE)", () => {
  it("distance3 — 3-4-5 triangle + z", () => {
    expect(distance3({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 12 })).toBe(12);
  });

  it("distanceToAabb — 0 inside, clamped outside", () => {
    const box = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
    expect(distanceToAabb({ x: 5, y: 5 }, box)).toBe(0); // inside
    expect(distanceToAabb({ x: 13, y: 5 }, box)).toBe(3); // 3 past +x face
    expect(distanceToAabb({ x: 13, y: 14 }, box)).toBe(5); // corner: (3,4) → 5
  });

  it("pointInAabb — boundary is inside", () => {
    const box = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
    expect(pointInAabb({ x: 0, y: 0 }, box)).toBe(true);
    expect(pointInAabb({ x: 5, y: 5 }, box)).toBe(true);
    expect(pointInAabb({ x: 11, y: 5 }, box)).toBe(false);
  });

  it("pointInPolygon — inside/outside/on-edge for a square", () => {
    const sq: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 5 }, sq)).toBe(true); // on edge → inside
  });

  it("pointInPolygon — concave (L-shape) notch is outside", () => {
    const L: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    expect(pointInPolygon({ x: 2, y: 2 }, L)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, L)).toBe(false); // in the notch
  });

  it("humanInZoneFootprint — no geometry ⇒ always monitored", () => {
    expect(humanInZoneFootprint({ x: 9999, y: 9999 }, null)).toBe(true);
    expect(humanInZoneFootprint({ x: 9999, y: 9999 }, {})).toBe(true);
  });
});

describe("levelForDistance (PURE) — 3 graduated bands", () => {
  it("none outside speed-reduce", () => expect(levelForDistance(2500, ZONE)).toBe("none"));
  it("none exactly on the speed-reduce boundary (strictly-nearer bands)", () =>
    expect(levelForDistance(2000, ZONE)).toBe("none"));
  it("speed_reduce inside outer band", () => expect(levelForDistance(1500, ZONE)).toBe("speed_reduce"));
  it("stop inside middle band", () => expect(levelForDistance(800, ZONE)).toBe("stop"));
  it("rated_stop inside innermost band", () => expect(levelForDistance(300, ZONE)).toBe("rated_stop"));
});

describe("evaluateZones (PURE)", () => {
  const robot: RobotPos = { id: 7, x: 0, y: 0, z: 0 };

  it("returns none when nearest human is beyond speed-reduce", () => {
    const humans: HumanPos[] = [{ id: "a", x: 3000, y: 0, confidence: 1 }];
    const [r] = evaluateZones(humans, [robot], [ZONE]);
    expect(r.level).toBe("none");
    expect(r.triggeringZoneId).toBeNull();
  });

  it("speed_reduce band → level + reactionSpeedPct + speed_violation-ready", () => {
    const humans: HumanPos[] = [{ id: "a", x: 1500, y: 0, confidence: 1 }];
    const [r] = evaluateZones(humans, [robot], [ZONE]);
    expect(r.level).toBe("speed_reduce");
    expect(r.nearestHumanId).toBe("a");
    expect(r.nearestDistanceMm).toBe(1500);
    expect(r.reactionSpeedPct).toBe(30);
    expect(r.triggeringZoneId).toBe(1);
  });

  it("stop band", () => {
    const humans: HumanPos[] = [{ id: "a", x: 800, y: 0, confidence: 1 }];
    expect(evaluateZones(humans, [robot], [ZONE])[0].level).toBe("stop");
  });

  it("rated_stop innermost + honest LOG-not-actuate note", () => {
    const humans: HumanPos[] = [{ id: "a", x: 300, y: 0, confidence: 1 }];
    const [r] = evaluateZones(humans, [robot], [ZONE]);
    expect(r.level).toBe("rated_stop");
    expect(r.note).toMatch(/Safety PLC/);
    expect(r.note).toMatch(/does NOT actuate/i);
  });

  it("multi-human → nearest drives the reaction", () => {
    const humans: HumanPos[] = [
      { id: "far", x: 1800, y: 0, confidence: 1 },
      { id: "near", x: 400, y: 0, confidence: 1 },
    ];
    const [r] = evaluateZones(humans, [robot], [ZONE]);
    expect(r.level).toBe("rated_stop");
    expect(r.nearestHumanId).toBe("near");
  });

  it("multi-robot → independent reactions", () => {
    const robots: RobotPos[] = [
      { id: 7, x: 0, y: 0 },
      { id: 8, x: 5000, y: 0 },
    ];
    const humans: HumanPos[] = [{ id: "a", x: 300, y: 0, confidence: 1 }];
    const res = evaluateZones(humans, robots, [ZONE]);
    const r7 = res.find((r) => r.robotId === 7)!;
    const r8 = res.find((r) => r.robotId === 8)!;
    expect(r7.level).toBe("rated_stop");
    expect(r8.level).toBe("none"); // human is 4700mm from robot 8
  });

  it("low-confidence human is ignored (below minConfidence)", () => {
    const humans: HumanPos[] = [{ id: "ghost", x: 300, y: 0, confidence: 0.2 }];
    expect(evaluateZones(humans, [robot], [ZONE], { minConfidence: 0.5 })[0].level).toBe("none");
  });

  it("AABB footprint gates monitoring — human outside footprint ignored for that zone", () => {
    const zone: SafetyZoneSpec = { ...ZONE, geometry: { aabb: { min: { x: -100, y: -100 }, max: { x: 100, y: 100 } } } };
    // human is 300mm from robot (rated band) but OUTSIDE the tiny footprint → ignored.
    const humans: HumanPos[] = [{ id: "a", x: 300, y: 0, confidence: 1 }];
    expect(evaluateZones(humans, [robot], [zone])[0].level).toBe("none");
  });

  it("polygon footprint — human inside polygon is monitored, banded to robot", () => {
    const zone: SafetyZoneSpec = {
      ...ZONE,
      geometry: { polygon: { points: [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]] } },
    };
    const humans: HumanPos[] = [{ id: "a", x: 300, y: 0, confidence: 1 }];
    expect(evaluateZones(humans, [robot], [zone])[0].level).toBe("rated_stop");
  });

  it("disabled zone is skipped", () => {
    const humans: HumanPos[] = [{ id: "a", x: 300, y: 0, confidence: 1 }];
    expect(evaluateZones(humans, [robot], [{ ...ZONE, enabled: false }])[0].level).toBe("none");
  });

  it("robot-bound zone only applies to that robot", () => {
    const zone: SafetyZoneSpec = { ...ZONE, robotId: 99 };
    const humans: HumanPos[] = [{ id: "a", x: 300, y: 0, confidence: 1 }];
    // robot 7 ≠ zone.robotId 99 → not applied.
    expect(evaluateZones(humans, [robot], [zone])[0].level).toBe("none");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SERVICE — in-memory fake db (mirrors safety.s1.test.ts harness)
// ════════════════════════════════════════════════════════════════════════════
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  gte: (col: any, val: any) => ({ __op: "gte", __k: col?.name, __v: val }),
  desc: (col: any) => ({ __desc: col?.name }),
  sql: () => ({}),
}));

type Row = Record<string, any>;
const store: Record<string, Row[]> = { safety_events: [], safety_zones: [] };
const seq: Record<string, number> = {};
function nextId(t: string): number { seq[t] = (seq[t] ?? 0) + 1; return seq[t]; }
function reset() { for (const k of Object.keys(store)) store[k] = []; for (const k of Object.keys(seq)) seq[k] = 0; }
function tableName(t: any): string {
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}
function matchPred(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "and") return pred.__ps.every((p: any) => matchPred(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  return true;
}
function makeFakeDb() {
  return {
    select: () => ({
      from: (t: any) => {
        const name = tableName(t);
        let pred: any = null;
        const q: any = {
          where: (p: any) => { pred = p; return q; },
          orderBy: async () => (store[name] ?? []).filter((r) => matchPred(r, pred)),
          limit: async (n: number) => (store[name] ?? []).filter((r) => matchPred(r, pred)).slice(0, n),
          then: (resolve: any) => resolve((store[name] ?? []).filter((r) => matchPred(r, pred))),
        };
        return q;
      },
    }),
    insert: (t: any) => ({
      values: (vals: Row) => {
        const name = tableName(t);
        const row = { id: nextId(name), createdAt: new Date(), ...vals };
        store[name].push(row);
        return { returning: async () => [row] };
      },
    }),
    update: (t: any) => ({
      set: (vals: Row) => ({
        where: (pred: any) => ({
          returning: async () => {
            const name = tableName(t);
            const updated = (store[name] ?? []).filter((row) => matchPred(row, pred));
            for (const r of updated) Object.assign(r, vals);
            return updated;
          },
        }),
      }),
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: async () => makeFakeDb() }));
const emitSafetyEvent = vi.fn();
vi.mock("../../_core/socket", () => ({ emitSafetyEvent: (...a: any[]) => emitSafetyEvent(...a) }));
vi.mock("../ot/commandDispatcher", () => ({
  isInterlockAutoBlockEnabled: () => process.env.INTERLOCK_AUTO_BLOCK_ENABLED === "true",
  isOtControlEnabled: () => process.env.OT_CONTROL_ENABLED === "true",
}));

import { evaluateAndRecord, buildProposal, validateThresholds } from "./safetyZoneService";

const svcZone: SafetyZoneSpec = {
  id: 42,
  speedReduceDistanceMm: 2000,
  stopDistanceMm: 1000,
  ratedStopDistanceMm: 500,
  reactionSpeedPct: 25,
};

beforeEach(() => {
  reset();
  emitSafetyEvent.mockClear();
  delete process.env.SAFETY_ZONE_SW_ENABLED;
  delete process.env.SAFETY_AUDIT_ENABLED;
  delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
  delete process.env.OT_CONTROL_ENABLED;
});

describe("validateThresholds (PURE)", () => {
  it("accepts a valid graduated set", () =>
    expect(validateThresholds({ speedReduceDistanceMm: 2000, stopDistanceMm: 1000, ratedStopDistanceMm: 500 })).toBeNull());
  it("rejects stop < rated", () =>
    expect(validateThresholds({ speedReduceDistanceMm: 2000, stopDistanceMm: 400, ratedStopDistanceMm: 500 })).toMatch(/stopDistanceMm/));
  it("rejects speedReduce < stop", () =>
    expect(validateThresholds({ speedReduceDistanceMm: 800, stopDistanceMm: 1000, ratedStopDistanceMm: 500 })).toMatch(/speedReduceDistanceMm/));
});

describe("safetyZoneService.evaluateAndRecord (advisory)", () => {
  it("flag OFF → no-op (no reactions, no events)", async () => {
    const r = await evaluateAndRecord({
      humans: [{ id: "a", x: 300, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [svcZone],
    });
    expect(r.enabled).toBe(false);
    expect(r.reactions).toHaveLength(0);
    expect(store.safety_events).toHaveLength(0);
  });

  it("speed_reduce → records speed_violation event + attaches PROPOSAL (gate closed)", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    const r = await evaluateAndRecord({
      humans: [{ id: "a", x: 1500, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [svcZone],
    });
    expect(r.enabled).toBe(true);
    const rc = r.reactions[0];
    expect(rc.level).toBe("speed_reduce");
    expect(rc.proposal?.gateOpen).toBe(false);
    expect(rc.ratedStopLoggedNotActuated).toBe(false);
    expect(rc.safetyEventId).toBeDefined();
    expect(store.safety_events[0].eventType).toBe("speed_violation");
    expect(store.safety_events[0].outcome).toBe("reduced_speed");
  });

  it("stop → records zone_intrusion event + PROPOSAL", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    const r = await evaluateAndRecord({
      humans: [{ id: "a", x: 800, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [svcZone],
    });
    expect(r.reactions[0].level).toBe("stop");
    expect(r.reactions[0].proposal).toBeTruthy();
    expect(store.safety_events[0].eventType).toBe("zone_intrusion");
    expect(store.safety_events[0].outcome).toBe("stopped");
  });

  it("rated_stop → LOGS advisory (outcome logged_only) + ratedStopLoggedNotActuated, NO proposal, NO dispatch", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    // gate flags ON to prove we STILL never actuate a rated_stop.
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    const r = await evaluateAndRecord({
      humans: [{ id: "a", x: 300, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [svcZone],
    });
    const rc = r.reactions[0];
    expect(rc.level).toBe("rated_stop");
    expect(rc.ratedStopLoggedNotActuated).toBe(true);
    expect(rc.proposal).toBeNull(); // no command proposal for rated_stop
    expect(store.safety_events[0].eventType).toBe("zone_intrusion");
    expect(store.safety_events[0].outcome).toBe("logged_only"); // did NOT actuate
    expect(store.safety_events[0].notes).toMatch(/Safety PLC/);
  });

  it("flag on but SAFETY_AUDIT off → returns reactions but persists nothing", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    const r = await evaluateAndRecord({
      humans: [{ id: "a", x: 300, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [svcZone],
    });
    expect(r.enabled).toBe(true);
    expect(r.reactions[0].level).toBe("rated_stop");
    expect(r.recorded).toBe(0);
    expect(store.safety_events).toHaveLength(0);
  });

  it("buildProposal reflects gate flags", () => {
    expect(buildProposal().gateOpen).toBe(false);
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    expect(buildProposal().gateOpen).toBe(true);
  });
});
