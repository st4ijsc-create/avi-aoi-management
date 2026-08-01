/**
 * doc 24 Tier-2 (Twin) — enriched USDA export tests: MATERIALS + UsdPhysics + TRUE
 * per-joint kinematics.  PURE + DB-free (hand-built SceneGraph fixtures + assembleSceneGraph).
 *
 * Coverage (the enrichment on top of the T3 geometry export, which stays green):
 *   (a) UsdPreviewSurface materials emitted (per device STATE) + bound on each device prim.
 *   (b) opt-in UsdPhysics: PhysicsScene + rigid-body device prims + revolute/prismatic
 *       articulation joints (with lower/upper limits) for a robot with a kinematic model.
 *   (c) TRUE per-joint xforms use the model's AXIS/type — a prismatic joint translates
 *       (not rotateZ), a revolute joint carries the axis + a rest matrix (not a bare rotateZ).
 *   (d) geometry-only (physics off) stays valid + backward-compatible in shape.
 *   (e) empty scene-graph → a valid empty stage even with physics requested.
 */
import { describe, it, expect } from "vitest";
import { assembleSceneGraph, type SceneGraph, type DeviceNode } from "./sceneGraph";
import { sceneGraphToUsda } from "./usdExport";

/** Count non-overlapping occurrences of a substring. */
function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

/**
 * Fixture: a factory with a running AOI, an errored (→ aborted) AOI, and a SCARA robot
 * (kind "scara" → sample-scara: RRPR, i.e. revolute + PRISMATIC + revolute joints) carrying
 * 4 joint values. `assembleSceneGraph` derives kinematicModelId from the robot kind.
 */
function scaraFixture(): SceneGraph {
  return assembleSceneGraph({
    factory: { id: 1, code: "F1", name: "Factory 1" },
    zones: [{ id: 7, code: "Z7", name: "Cell A", zoneType: "production", maxConcurrentRobots: 2 }],
    lines: [{ id: 2, code: "L2", name: "Line 2", workshopId: 9 }],
    stations: [
      { id: 5, code: "S5", name: "Station 5", lineId: 2 },
      { id: 6, code: "S6", name: "Station 6", lineId: 2 },
    ],
    machines: [
      { id: 12, code: "M12", name: "AOI 12", stationId: 5, operationStatus: "running", modelUri: "m12.glb" },
      { id: 13, code: "M13", name: "AOI 13", stationId: 5, operationStatus: "error" }, // → aborted
    ],
    robots: [{ id: 3, code: "R3", name: "Scara 3", stationId: 6, status: "running", kind: "scara", joints: [0.1, 0.2, 50, 0.3] }],
  });
}

// ════════════════════════════════════════════════════════════════════════════
// (a) materials emitted + bound per device state
// ════════════════════════════════════════════════════════════════════════════
describe("sceneGraphToUsda — UsdPreviewSurface materials per device state", () => {
  it("emits a Looks scope with one material per used state (running=green, aborted=red)", () => {
    const usda = sceneGraphToUsda(scaraFixture());
    expect(usda).toContain(`def Scope "Looks"`);
    expect(usda).toContain(`def Material "Mat_running"`);
    expect(usda).toContain(`def Material "Mat_aborted"`);
    // one Shader per material, all UsdPreviewSurface.
    expect(usda).toContain(`uniform token info:id = "UsdPreviewSurface"`);
    // running → green-dominant, aborted → red-dominant (viewer state→colour semantics).
    expect(usda).toContain(`def Material "Mat_running"`);
    expect(usda).toContain(`color3f inputs:diffuseColor = (0.1333, 0.7725, 0.3686)`); // #22c55e
    expect(usda).toContain(`color3f inputs:diffuseColor = (0.9373, 0.2667, 0.2667)`); // #ef4444
    // exactly two distinct states appear → two materials.
    expect(count(usda, `def Material "Mat_`)).toBe(2);
  });

  it("binds the per-state material on each device prim (and its placeholder geometry)", () => {
    const usda = sceneGraphToUsda(scaraFixture());
    // running machine + running robot bind Mat_running; errored machine binds Mat_aborted.
    expect(usda).toContain(`rel material:binding = </factory_1/Looks/Mat_running>`);
    expect(usda).toContain(`rel material:binding = </factory_1/Looks/Mat_aborted>`);
    // placeholder cubes (robot:3 + machine:13 have no modelUri) also carry a binding →
    // more bindings than devices (device prim + its cube).
    expect(count(usda, `rel material:binding`)).toBeGreaterThan(3);
    // connection wiring is present + well-formed.
    expect(usda).toContain(`token outputs:surface.connect = </factory_1/Looks/Mat_running/PreviewSurface.outputs:surface>`);
  });

  it("materials can be turned off for a bare geometry stage", () => {
    const usda = sceneGraphToUsda(scaraFixture(), { includeMaterials: false });
    expect(usda).not.toContain(`def Scope "Looks"`);
    expect(usda).not.toContain(`def Material`);
    expect(usda).not.toContain(`rel material:binding`);
    // geometry hierarchy still intact.
    expect(usda).toContain(`def Xform "machine_12"`);
    expect(usda).toContain(`def Cube "geo"`);
    expect(count(usda, "{")).toBe(count(usda, "}"));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b) opt-in UsdPhysics: scene + rigid bodies + revolute/prismatic joints + limits
// ════════════════════════════════════════════════════════════════════════════
describe("sceneGraphToUsda — opt-in UsdPhysics layer", () => {
  it("emits a PhysicsScene, rigid-body device prims, and articulation joints", () => {
    const usda = sceneGraphToUsda(scaraFixture(), { includePhysics: true });
    // Physics scene with gravity down the Z up-axis.
    expect(usda).toContain(`def PhysicsScene "PhysicsScene"`);
    expect(usda).toContain(`vector3f physics:gravityDirection = (0, 0, -1)`);
    // machines → rigid bodies + colliders.
    expect(usda).toContain(`prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsCollisionAPI"]`);
    // robot with a kinematic model → an articulation root + a flat Physics link scope.
    expect(usda).toContain(`prepend apiSchemas = ["PhysicsArticulationRootAPI"]`);
    expect(usda).toContain(`def Scope "Physics"`);
    expect(usda).toContain(`def Xform "Link_0"`);
    // both revolute AND prismatic joints exist (SCARA = RRPR).
    expect(usda).toContain(`def PhysicsRevoluteJoint "PhysJoint_0"`);
    expect(usda).toContain(`def PhysicsPrismaticJoint "PhysJoint_2"`);
    expect(usda).toContain(`uniform token physics:axis = "Z"`);
    // body0/body1 wire the chain (base → link0 → link1 …).
    expect(usda).toContain(`rel physics:body1 = </factory_1/Lines/line_2/station_6/robot_3/Physics/Link_0>`);
  });

  it("carries per-joint lower/upper limits (prismatic in mm, revolute in degrees)", () => {
    const usda = sceneGraphToUsda(scaraFixture(), { includePhysics: true });
    const uppers = [...usda.matchAll(/physics:upperLimit = (-?\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
    const lowers = [...usda.matchAll(/physics:lowerLimit = (-?\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
    // prismatic z: 0..150 mm (exact).
    expect(uppers.some((v) => Math.abs(v - 150) < 1e-6)).toBe(true);
    expect(lowers.some((v) => Math.abs(v - 0) < 1e-6)).toBe(true);
    // revolute j1: ±140° (converted from radians).
    expect(uppers.some((v) => Math.abs(v - 140) < 1e-3)).toBe(true);
    expect(lowers.some((v) => Math.abs(v + 140) < 1e-3)).toBe(true);
    // still a well-formed stage.
    expect(count(usda, "{")).toBe(count(usda, "}"));
    expect(count(usda, "{")).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (c) TRUE per-joint kinematics reflect the model's axis/type (not a bare rotateZ)
// ════════════════════════════════════════════════════════════════════════════
describe("sceneGraphToUsda — true per-joint kinematics from the model", () => {
  it("prismatic joint TRANSLATES along its axis; revolute carries axis + a rest matrix", () => {
    const usda = sceneGraphToUsda(scaraFixture());
    // 4 SCARA joints (RRPR) → Joint_0..Joint_3.
    expect(count(usda, `def Xform "Joint_`)).toBe(4);
    // Joint_2 is the PRISMATIC z → a translate (along Z by 50), NOT a rotateZ.
    expect(usda).toContain(`custom string st4i:jointType = "prismatic"`);
    expect(usda).toContain(`double3 xformOp:translate:joint = (0, 0, 50)`);
    // Every joint records its true axis (SCARA DH axis = Z).
    expect(usda).toContain(`custom double3 st4i:jointAxis = (0, 0, 1)`);
    // NOT a bare-rotateZ placeholder chain: real rest transforms are emitted as matrices,
    // and j1's DH rest (a=300,d=200) shows up as a translate row.
    expect(usda).toContain(`matrix4d xformOp:transform:rest =`);
    expect(usda).toContain(`(300, 0, 200, 1)`); // j1 rest DH → translate(300,0,200)
    // a revolute joint still uses its Z rotate op (with the correct xformOpOrder incl. rest).
    expect(usda).toContain(`uniform token[] xformOpOrder = ["xformOp:rotateZ", "xformOp:transform:rest"]`);
  });

  it("falls back to the placeholder rotateZ chain when no kinematic model resolves", () => {
    // Hand-build a robot with joints but NO kinematicModelId → placeholder path.
    const robot: DeviceNode = {
      id: "robot:9", kind: "robot", refId: 9, code: "R9", name: "Unknown 9", stationId: null,
      state: "running", color: "#0f0", position: null, bounds: null,
      modelUri: null, modelKind: null, activeTaskId: null, alarm: null,
      joints: [0, Math.PI / 2], kinematicModelId: null,
    };
    const g: SceneGraph = {
      factory: { id: 1, code: "F1", name: "Factory 1" }, zones: [], lines: [], devices: [robot], ts: 1,
    };
    const usda = sceneGraphToUsda(g);
    expect(count(usda, `def Xform "Joint_`)).toBe(2);
    expect(usda).toContain(`double xformOp:rotateZ = 90`); // PI/2 → 90°
    // placeholder path emits no rest matrix.
    expect(usda).not.toContain(`matrix4d xformOp:transform:rest`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (d) geometry-only (physics off) stays valid + backward-compatible
// ════════════════════════════════════════════════════════════════════════════
describe("sceneGraphToUsda — geometry-only (physics off) unchanged shape", () => {
  it("physics off (default) emits no physics prims but keeps geometry + kinematics", () => {
    const usda = sceneGraphToUsda(scaraFixture());
    expect(usda).not.toContain(`def PhysicsScene`);
    expect(usda).not.toContain(`PhysicsRigidBodyAPI`);
    expect(usda).not.toContain(`PhysicsRevoluteJoint`);
    expect(usda).not.toContain(`def Scope "Physics"`);
    // hierarchy + placeholder geometry + joint chain intact.
    expect(usda).toContain(`def Xform "factory_1"`);
    expect(usda).toContain(`def Cube "geo"`);
    expect(count(usda, `def Xform "Joint_`)).toBe(4);
    expect(count(usda, "{")).toBe(count(usda, "}"));
  });

  it("materials off + physics off → the bare geometry stage (no enrichment prims)", () => {
    const usda = sceneGraphToUsda(scaraFixture(), { includeMaterials: false, includePhysics: false });
    expect(usda).not.toContain(`def Material`);
    expect(usda).not.toContain(`def PhysicsScene`);
    expect(usda).not.toContain(`apiSchemas`);
    expect(usda).not.toContain(`material:binding`);
    // device provenance round-trips (3 devices).
    expect(count(usda, `custom string st4i:deviceId`)).toBe(3);
    expect(count(usda, "{")).toBe(count(usda, "}"));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (e) empty scene-graph → a valid empty stage even with physics requested
// ════════════════════════════════════════════════════════════════════════════
describe("sceneGraphToUsda — degrade-safe empty stage", () => {
  it("empty graph → a valid empty stage (no prims) regardless of physics/materials flags", () => {
    const empty: SceneGraph = { factory: null, zones: [], lines: [], devices: [], ts: 0 };
    const usda = sceneGraphToUsda(empty, { includePhysics: true, includeMaterials: true });
    expect(usda.startsWith("#usda 1.0")).toBe(true);
    expect(usda).toContain("empty stage");
    expect(count(usda, "def ")).toBe(0); // no prims at all
    expect(count(usda, "{")).toBe(count(usda, "}")); // 0 == 0
  });
});
