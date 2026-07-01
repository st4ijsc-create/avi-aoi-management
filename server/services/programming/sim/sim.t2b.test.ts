/**
 * T2b (doc 20 §1/§5 · doc 16 §11.2) — Kinematic Simulation Gate tests. PURE / in-memory.
 *
 * Covers:
 *   • FK correctness on a KNOWN 2-link chain (analytic check).
 *   • Collision DETECTED when a waypoint puts a link inside an obstacle; CLEAR when not.
 *   • Joint-limit flagged when a move exceeds a limit.
 *   • Safety-zone violation when a link enters a zone.
 *   • Cycle-time monotonic with speed.
 *   • Gate PASSES on a safe program.
 *   • Flag-OFF → structural fallback (IR adapter).
 *   • No-model → honest non-fabricated result (pass:false, clear note).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  forwardKinematics,
  checkJointLimits,
  dhTransform,
  mat4Mul,
  mat4Identity,
  mat4TransformPoint,
  resolveKinematicModel,
  urdfToChainStub,
  SAMPLE_ARM_6DOF,
  SAMPLE_SCARA,
  type KinematicModel,
} from "./kinematicModel";
import { bvDistance, checkCollisionsAtWaypoint, type Obstacle } from "./collision";
import {
  runKinematicSimGate,
  runGateForFlow,
  noModelResult,
  simKinematicEnabled,
  type SimScene,
} from "./kinematicSimGate";
import { boundsToAabb, sceneFromGraph } from "./sceneAdapter";
import { IrProgrammingAdapter } from "../ir/irAdapter";
import type { Flow } from "../ir/irModel";

// A known planar 2-link revolute chain (both in the XY plane; link lengths L1, L2).
// After joint angles (q1, q2), link1 origin is at (L1·cos q1, L1·sin q1, 0) and the
// end (link2 origin) is at forward-kinematics of a planar 2R arm.
const L1 = 200;
const L2 = 150;
const TWO_LINK: KinematicModel = {
  id: "test-2link",
  label: "planar 2R (test)",
  deviceType: "generic",
  base: mat4Identity(),
  workspace: { min: [-500, -500, -100], max: [500, 500, 100] },
  dof: 2,
  joints: [
    { name: "j1", type: "revolute", dh: { a: L1, alpha: 0, d: 0, theta: 0 }, limits: { min: -Math.PI, max: Math.PI }, bv: { kind: "sphere", center: [0, 0, 0], radius: 10 } },
    { name: "j2", type: "revolute", dh: { a: L2, alpha: 0, d: 0, theta: 0 }, limits: { min: -Math.PI / 2, max: Math.PI / 2 }, bv: { kind: "sphere", center: [0, 0, 0], radius: 10 } },
  ],
};

describe("T2b · forward kinematics (analytic)", () => {
  it("2-link chain: FK matches the planar 2R closed form", () => {
    const q1 = Math.PI / 6; // 30°
    const q2 = Math.PI / 4; // 45°
    const poses = forwardKinematics(TWO_LINK, [q1, q2]);
    // link1 origin: (L1 cos q1, L1 sin q1, 0)
    expect(poses[0].origin[0]).toBeCloseTo(L1 * Math.cos(q1), 6);
    expect(poses[0].origin[1]).toBeCloseTo(L1 * Math.sin(q1), 6);
    expect(poses[0].origin[2]).toBeCloseTo(0, 6);
    // end (link2 origin): planar 2R closed form
    const ex = L1 * Math.cos(q1) + L2 * Math.cos(q1 + q2);
    const ey = L1 * Math.sin(q1) + L2 * Math.sin(q1 + q2);
    expect(poses[1].origin[0]).toBeCloseTo(ex, 6);
    expect(poses[1].origin[1]).toBeCloseTo(ey, 6);
  });

  it("zero joints → link along +X by DH `a`", () => {
    const poses = forwardKinematics(TWO_LINK, [0, 0]);
    expect(poses[0].origin[0]).toBeCloseTo(L1, 6);
    expect(poses[1].origin[0]).toBeCloseTo(L1 + L2, 6);
  });

  it("dhTransform composes correctly (identity for all-zero DH)", () => {
    const m = dhTransform(0, 0, 0, 0);
    expect(m).toEqual(mat4Identity());
    // chaining two pure-a translations along X accumulates.
    const chained = mat4Mul(dhTransform(L1, 0, 0, 0), dhTransform(L2, 0, 0, 0));
    expect(mat4TransformPoint(chained, [0, 0, 0])[0]).toBeCloseTo(L1 + L2, 6);
  });
});

describe("T2b · joint limits", () => {
  it("flags a joint that exceeds its limit", () => {
    const v = checkJointLimits(TWO_LINK, [0, Math.PI]); // j2 max is PI/2
    expect(v).toHaveLength(1);
    expect(v[0].joint).toBe("j2");
  });
  it("clean when within limits", () => {
    expect(checkJointLimits(TWO_LINK, [0, Math.PI / 4])).toHaveLength(0);
  });
});

describe("T2b · collision (geometric bounding volumes)", () => {
  it("sphere↔sphere distance is centre-distance minus radii", () => {
    const d = bvDistance({ kind: "sphere", center: [0, 0, 0], radius: 5 }, { kind: "sphere", center: [20, 0, 0], radius: 5 });
    expect(d).toBeCloseTo(10, 6);
  });

  it("DETECTS a collision when a link sphere is inside an obstacle AABB", () => {
    const obstacles: Obstacle[] = [{ id: "obs1", volume: { kind: "aabb", min: [-10, -10, -10], max: [10, 10, 10] } }];
    const links = [{ name: "j1", bv: { kind: "sphere" as const, center: [0, 0, 0], radius: 5 } }];
    const events = checkCollisionsAtWaypoint(0, links, obstacles, { margin: 0 });
    expect(events.length).toBe(1);
    expect(events[0].linkB).toBe("obs1");
    expect(events[0].distance).toBeLessThanOrEqual(0);
  });

  it("CLEAR when the link is far from the obstacle", () => {
    const obstacles: Obstacle[] = [{ id: "obs1", volume: { kind: "aabb", min: [1000, 1000, 1000], max: [1010, 1010, 1010] } }];
    const links = [{ name: "j1", bv: { kind: "sphere" as const, center: [0, 0, 0], radius: 5 } }];
    expect(checkCollisionsAtWaypoint(0, links, obstacles, { margin: 0 })).toHaveLength(0);
  });

  it("self-collision excludes adjacent links", () => {
    const links = [
      { name: "a", bv: { kind: "sphere" as const, center: [0, 0, 0], radius: 5 } },
      { name: "b", bv: { kind: "sphere" as const, center: [0, 0, 0], radius: 5 } }, // adjacent to a — excluded
      { name: "c", bv: { kind: "sphere" as const, center: [0, 0, 0], radius: 5 } }, // non-adjacent to a → collides
    ];
    const events = checkCollisionsAtWaypoint(0, links, [], { selfCollision: true });
    // a-c is the only non-adjacent overlapping pair.
    expect(events).toHaveLength(1);
    expect(events[0].linkA).toBe("a");
    expect(events[0].linkB).toBe("c");
  });
});

// ── Full gate ────────────────────────────────────────────────────────────────

function jointFlow(joints: number[], speedPct = 50): Flow {
  return {
    flow_id: "test_joint",
    target_device_type: "generic",
    version: 1,
    blocks: [{ type: "move_joint", joints, speed_pct: speedPct }],
  };
}

describe("T2b · kinematic simulation gate", () => {
  it("PASSES a safe joint move (no obstacles, within limits)", () => {
    const flow = jointFlow([0.1, 0.1, 0, 0], 50);
    const scene: SimScene = { obstacles: [], safetyZones: [] };
    const r = runKinematicSimGate(flow, SAMPLE_SCARA, scene, {});
    expect(r.pass).toBe(true);
    expect(r.collision_events).toHaveLength(0);
    expect(r.joint_limit_violations).toHaveLength(0);
    expect(r.safety_zone_violations).toHaveLength(0);
    expect(r.waypointsChecked).toBeGreaterThan(0);
  });

  it("FAILS when a joint move exceeds a limit", () => {
    // SCARA j1 limit is ±140° ≈ ±2.44 rad — 3.0 rad exceeds it.
    const flow = jointFlow([3.0, 0, 0, 0], 50);
    const r = runKinematicSimGate(flow, SAMPLE_SCARA, { obstacles: [], safetyZones: [] }, {});
    expect(r.pass).toBe(false);
    expect(r.joint_limit_violations.length).toBeGreaterThan(0);
    expect(r.joint_limit_violations[0].joint).toBe("j1");
  });

  it("DETECTS a collision when a link enters an obstacle placed at a link's world pose", () => {
    // At zero pose the SCARA link1 capsule runs from world (0,0,200) to (300,0,200).
    // Place an obstacle box straddling that segment so the link volume overlaps it.
    const obstacles: Obstacle[] = [{ id: "cage", volume: { kind: "aabb", min: [400, -30, 170], max: [500, 30, 230] } }];
    const flow = jointFlow([0, 0, 0, 0], 50);
    const r = runKinematicSimGate(flow, SAMPLE_SCARA, { obstacles, safetyZones: [] }, {});
    expect(r.pass).toBe(false);
    expect(r.collision_events.length).toBeGreaterThan(0);
    expect(r.collision_events[0].isObstacle).toBe(true);
  });

  it("FLAGS a safety-zone violation when a link enters a zone", () => {
    // A zone covering the SCARA's reach at zero pose (link origins near +X 300..550).
    const scene: SimScene = {
      obstacles: [],
      safetyZones: [{ id: "zone:human", zoneType: "human_shared", min: [-1000, -1000, -1000], max: [1000, 1000, 1000] }],
    };
    const flow = jointFlow([0.1, 0.1, 0, 0], 50);
    const r = runKinematicSimGate(flow, SAMPLE_SCARA, scene, {});
    expect(r.pass).toBe(false);
    expect(r.safety_zone_violations.length).toBeGreaterThan(0);
    expect(r.safety_zone_violations[0].zoneType).toBe("human_shared");
  });

  it("cycle_time_actual is MONOTONIC with speed (faster ⇒ shorter)", () => {
    const slow = runKinematicSimGate(jointFlow([1.0, 0, 0, 0], 20), SAMPLE_SCARA, { obstacles: [], safetyZones: [] }, {});
    const fast = runKinematicSimGate(jointFlow([1.0, 0, 0, 0], 80), SAMPLE_SCARA, { obstacles: [], safetyZones: [] }, {});
    expect(fast.cycle_time_actual).toBeLessThan(slow.cycle_time_actual);
    expect(slow.cycle_time_actual).toBeGreaterThan(0);
  });

  it("move_linear outside workspace fails the gate (unreachable)", () => {
    const flow: Flow = {
      flow_id: "far",
      target_device_type: "universal-robots",
      version: 1,
      blocks: [{ type: "move_linear", target_pose: { x: 5000, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }, speed_mms: 100, acceleration: 500, blend_radius: 0 }],
    };
    const r = runKinematicSimGate(flow, SAMPLE_ARM_6DOF, { obstacles: [], safetyZones: [] }, {});
    expect(r.pass).toBe(false);
    expect(r.joint_limit_violations.some((v) => v.joint.startsWith("<workspace"))).toBe(true);
  });

  it("returns EXACTLY the contract shape", () => {
    const r = runKinematicSimGate(jointFlow([0.1, 0, 0, 0]), SAMPLE_SCARA, { obstacles: [], safetyZones: [] }, {});
    expect(Object.keys(r).sort()).toEqual(
      ["collision_events", "cycle_time_actual", "joint_limit_violations", "note", "pass", "safety_zone_violations", "waypointsChecked"].sort(),
    );
  });
});

describe("T2b · no-model honesty", () => {
  it("resolveKinematicModel returns null for ros2 (no authored sample)", () => {
    expect(resolveKinematicModel("ros2")).toBeNull();
    expect(resolveKinematicModel("universal-robots")).toBe(SAMPLE_ARM_6DOF);
    expect(resolveKinematicModel("generic")).toBe(SAMPLE_SCARA);
  });

  it("noModelResult does NOT fabricate a pass", () => {
    const r = noModelResult("ros2");
    expect(r.pass).toBe(false);
    expect(r.waypointsChecked).toBe(0);
    expect(r.note).toMatch(/NO kinematic model/i);
  });

  it("runGateForFlow on a no-model device returns the honest no-model result", () => {
    const flow: Flow = { flow_id: "r", target_device_type: "ros2", version: 1, blocks: [{ type: "move_joint", joints: [0], speed_pct: 10 }] };
    const r = runGateForFlow(flow, { obstacles: [], safetyZones: [] });
    expect(r.pass).toBe(false);
    expect(r.note).toMatch(/structural-only/i);
  });

  it("urdfToChainStub returns null (T2a seam, not faked)", () => {
    expect(urdfToChainStub("<robot/>")).toBeNull();
  });
});

describe("T2b · scene adapter", () => {
  it("parses {x,y,w,h} and {min,max} bounds into world AABBs", () => {
    expect(boundsToAabb({ x: 0, y: 0, w: 10, h: 20 })).toEqual({ min: [0, 0, 0], max: [10, 20, 500] });
    expect(boundsToAabb({ min: [1, 2, 3], max: [4, 5, 6] })).toEqual({ min: [1, 2, 3], max: [4, 5, 6] });
    expect(boundsToAabb(null)).toBeNull();
  });

  it("sceneFromGraph promotes human_shared zones to safetyZones + obstacles", () => {
    const scene = sceneFromGraph({
      factory: null,
      zones: [{ id: "zone:1", refId: 1, code: "Z1", name: "Cell", zoneType: "human_shared", maxConcurrentRobots: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }],
      lines: [],
      devices: [{ id: "machine:1", kind: "machine", refId: 1, code: "M1", name: "Mill", stationId: 1, state: "idle", color: "#ccc", position: null, bounds: { x: 0, y: 0, w: 1, h: 1 }, modelUri: null, modelKind: null, activeTaskId: null, alarm: null }],
      ts: Date.now(),
    });
    expect(scene.safetyZones).toHaveLength(1);
    expect(scene.safetyZones[0].zoneType).toBe("human_shared");
    // one machine obstacle + one zone obstacle
    expect(scene.obstacles.length).toBe(2);
  });
});

// ── IR adapter integration: flag-off fallback vs flag-on gate ────────────────────

const SAFE_JOINT_FLOW_JSON = JSON.stringify({
  flow_id: "adapter_safe",
  target_device_type: "generic",
  version: 1,
  blocks: [{ type: "move_joint", joints: [0.1, 0.1, 0, 0], speed_pct: 50 }],
});

describe("T2b · IR adapter simulate() wiring", () => {
  const prev = process.env.SIM_KINEMATIC_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.SIM_KINEMATIC_ENABLED;
    else process.env.SIM_KINEMATIC_ENABLED = prev;
  });

  it("flag OFF → honest STRUCTURAL preview (today's behavior)", async () => {
    delete process.env.SIM_KINEMATIC_ENABLED;
    expect(simKinematicEnabled()).toBe(false);
    const adapter = new IrProgrammingAdapter();
    const build = await adapter.compile({ kind: "ir-flow", language: "ir-json", content: SAFE_JOINT_FLOW_JSON });
    const sim = await adapter.simulate(build, {});
    expect(sim.warnings.join(" ")).toMatch(/STRUCTURAL preview/i);
    expect(sim.timeline[0].note).toBe("ir-structural-preview");
  });

  it("flag ON → runs the KINEMATIC gate (real waypoints)", async () => {
    process.env.SIM_KINEMATIC_ENABLED = "true";
    expect(simKinematicEnabled()).toBe(true);
    const adapter = new IrProgrammingAdapter();
    const build = await adapter.compile({ kind: "ir-flow", language: "ir-json", content: SAFE_JOINT_FLOW_JSON });
    const sim = await adapter.simulate(build, {});
    expect(sim.timeline[0].note).toBe("ir-kinematic-simgate");
    expect(sim.ok).toBe(true); // safe program passes
    const gate = (sim as unknown as { simGate?: { waypointsChecked: number } }).simGate;
    expect(gate?.waypointsChecked).toBeGreaterThan(0);
  });

  it("flag ON + colliding program → sim NOT ok (gate blocks)", async () => {
    process.env.SIM_KINEMATIC_ENABLED = "true";
    const collidingFlow = JSON.stringify({
      flow_id: "adapter_collide",
      target_device_type: "generic",
      version: 1,
      blocks: [{ type: "move_joint", joints: [0, 0, 0, 0], speed_pct: 50 }],
    });
    const adapter = new IrProgrammingAdapter();
    // Inject an obstacle at the base via a scene on the scenario.
    const build = await adapter.compile({ kind: "ir-flow", language: "ir-json", content: collidingFlow });
    const scene: SimScene = { obstacles: [{ id: "cage", volume: { kind: "aabb", min: [400, -30, 170], max: [500, 30, 230] } }], safetyZones: [] };
    const sim = await adapter.simulate(build, { scene } as never);
    expect(sim.ok).toBe(false);
    expect(sim.warnings.join(" ")).toMatch(/COLLISION/);
  });
});
