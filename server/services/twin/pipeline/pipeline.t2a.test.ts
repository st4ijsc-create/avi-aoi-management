/**
 * T2a (doc 20 §1/§5) — CAD/URDF → glTF model pipeline tests. PURE / in-memory.
 *
 * Covers:
 *   • URDF PARSE: links / joints / limits / geometry / origins / axis / root detection.
 *   • glTF EMIT: structurally valid glTF (asset 2.0, scenes, accessors/bufferViews/buffer,
 *     POSITION min/max, node hierarchy) for box / cylinder / sphere + node TRS from joints.
 *   • External-mesh HONESTY: an unresolved <mesh> → placeholder box + recorded ref; ASCII-STL
 *     resolved → real triangles.
 *   • urdfToKinematicChain: joints + limits + bounding volumes match the URDF, and T2b CONSUMES
 *     it — a colliding program on the converted chain FAILS the sim gate (proof the seam is real).
 *   • Conversion service: flag-off no-op; flag-on writes a 'ready' registry row + a real .gltf
 *     file; a bad URDF → 'failed' honestly (never 'ready'); STEP seam → 'pending', not faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  parseUrdf,
  walkLinkTree,
} from "./urdfParser";
import { urdfToGltf, triangulateAsciiStl } from "./urdfToGltf";
import { urdfToKinematicChain } from "./urdfToKinematicChain";
import { SAMPLE_URDF_3DOF_ARM, SAMPLE_URDF_2DOF_PLANAR } from "./sampleUrdfs";
import { forwardKinematics } from "../../programming/sim/kinematicModel";
import { runKinematicSimGate, type SimScene } from "../../programming/sim/kinematicSimGate";
import type { Obstacle } from "../../programming/sim/collision";

// ════════════════════════════════════════════════════════════════════════════
// URDF PARSER
// ════════════════════════════════════════════════════════════════════════════
describe("T2a · URDF parser", () => {
  it("parses links, joints, geometry, limits, origins and axis", () => {
    const robot = parseUrdf(SAMPLE_URDF_3DOF_ARM);
    expect(robot.name).toBe("sample_3dof_arm");
    expect(robot.links.map((l) => l.name)).toEqual(["base_link", "link1", "link2", "tool_link"]);
    expect(robot.joints.map((j) => j.name)).toEqual(["shoulder", "elbow", "wrist"]);

    const shoulder = robot.joints[0];
    expect(shoulder.type).toBe("revolute");
    expect(shoulder.parent).toBe("base_link");
    expect(shoulder.child).toBe("link1");
    expect(shoulder.origin.xyz).toEqual([0, 0, 0.1]);
    expect(shoulder.axis).toEqual([0, 0, 1]);
    expect(shoulder.limit?.lower).toBeCloseTo(-3.14159, 4);
    expect(shoulder.limit?.upper).toBeCloseTo(3.14159, 4);

    // geometry kinds
    expect(robot.links[0].visual?.geometry.kind).toBe("cylinder");
    expect(robot.links[1].visual?.geometry.kind).toBe("box");
    expect(robot.links[3].visual?.geometry.kind).toBe("sphere");
  });

  it("detects the root link (never a child) and builds the tree", () => {
    const robot = parseUrdf(SAMPLE_URDF_3DOF_ARM);
    expect(robot.rootLink).toBe("base_link");
    const tree = walkLinkTree(robot);
    expect(tree.map((t) => t.link.name)).toEqual(["base_link", "link1", "link2", "tool_link"]);
    expect(tree[0].joint).toBeNull(); // root carried by no joint
    expect(tree[1].joint?.name).toBe("shoulder");
  });

  it("rejects DOCTYPE (XXE protection) and a non-<robot> root", () => {
    expect(() => parseUrdf(`<!DOCTYPE x><robot/>`)).toThrow(/DOCTYPE/i);
    expect(() => parseUrdf(`<notrobot/>`)).toThrow(/robot/i);
  });

  it("parses mesh geometry with filename + scale", () => {
    const robot = parseUrdf(
      `<robot name="m"><link name="a"><visual><geometry><mesh filename="arm.stl" scale="2 2 2"/></geometry></visual></link></robot>`,
    );
    const g = robot.links[0].visual?.geometry;
    expect(g?.kind).toBe("mesh");
    if (g?.kind === "mesh") {
      expect(g.filename).toBe("arm.stl");
      expect(g.scale).toEqual([2, 2, 2]);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// glTF EMITTER
// ════════════════════════════════════════════════════════════════════════════
describe("T2a · glTF emitter", () => {
  it("emits a structurally valid glTF 2.0 for box/cylinder/sphere primitives", () => {
    const robot = parseUrdf(SAMPLE_URDF_3DOF_ARM);
    const out = urdfToGltf(robot);
    const g = out.gltf as any;

    expect(g.asset.version).toBe("2.0");
    expect(g.scene).toBe(0);
    expect(Array.isArray(g.scenes[0].nodes)).toBe(true);
    expect(g.scenes[0].nodes.length).toBeGreaterThan(0);
    // one node per link (4), and 4 meshes (all links have geometry).
    expect(g.nodes.length).toBe(4);
    expect(g.meshes.length).toBe(4);
    expect(g.buffers.length).toBe(1);
    expect(String(g.buffers[0].uri)).toMatch(/^data:application\/octet-stream;base64,/);
    expect(g.buffers[0].byteLength).toBeGreaterThan(0);

    // Every mesh primitive references POSITION + NORMAL + indices accessors.
    for (const m of g.meshes) {
      const prim = m.primitives[0];
      expect(prim.attributes.POSITION).toBeTypeOf("number");
      expect(prim.attributes.NORMAL).toBeTypeOf("number");
      expect(prim.indices).toBeTypeOf("number");
      // POSITION accessor MUST carry min/max (drei/three require it).
      const pos = g.accessors[prim.attributes.POSITION];
      expect(pos.type).toBe("VEC3");
      expect(pos.min).toHaveLength(3);
      expect(pos.max).toHaveLength(3);
      expect(pos.count).toBeGreaterThan(0);
    }

    // bufferViews byteOffsets are 4-byte aligned and within the buffer.
    const totalLen = g.buffers[0].byteLength;
    for (const bv of g.bufferViews) {
      expect(bv.byteOffset % 4).toBe(0);
      expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(totalLen);
    }
  });

  it("mirrors the joint tree as node hierarchy with joint origins as node TRS", () => {
    const robot = parseUrdf(SAMPLE_URDF_3DOF_ARM);
    const g = urdfToGltf(robot).gltf as any;
    // base_link node should have link1 as a child; link1 node has translation from the shoulder origin.
    const nodeByName: Record<string, any> = {};
    g.nodes.forEach((n: any) => (nodeByName[n.name] = n));
    expect(nodeByName.base_link.children).toBeDefined();
    // link1 placed by the shoulder joint origin (0,0,0.1).
    expect(nodeByName.link1.translation).toEqual([0, 0, 0.1]);
  });

  it("emits a placeholder + records the ref for an unresolved external <mesh> (no fabricated geometry)", () => {
    const robot = parseUrdf(
      `<robot name="m"><link name="a"><visual><geometry><mesh filename="arm.stl" scale="1 1 1"/></geometry></visual></link></robot>`,
    );
    const out = urdfToGltf(robot);
    expect(out.externalMeshes).toHaveLength(1);
    expect(out.externalMeshes[0].filename).toBe("arm.stl");
    expect(out.meshCount).toBe(1); // placeholder box still emitted so the node renders
  });

  it("triangulates an ASCII STL mesh into real geometry when provided", () => {
    const stl = `solid s
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid s`;
    const tri = triangulateAsciiStl(stl);
    expect(tri).not.toBeNull();
    expect(tri!.positions.length).toBe(9); // 3 verts * xyz
    expect(tri!.indices.length).toBe(3);

    const robot = parseUrdf(
      `<robot name="m"><link name="a"><visual><geometry><mesh filename="arm.stl" scale="1 1 1"/></geometry></visual></link></robot>`,
    );
    const out = urdfToGltf(robot, { meshResolver: (fn) => (fn === "arm.stl" ? stl : null) });
    expect(out.externalMeshes).toHaveLength(0); // resolved → no placeholder
  });
});

// ════════════════════════════════════════════════════════════════════════════
// KINEMATIC CHAIN EXTRACTION (feeds T2b)
// ════════════════════════════════════════════════════════════════════════════
describe("T2a · urdfToKinematicChain (closes the T2b seam)", () => {
  it("produces joints + limits + bounding volumes matching the URDF (mm)", () => {
    const robot = parseUrdf(SAMPLE_URDF_3DOF_ARM);
    const chain = urdfToKinematicChain(robot, { deviceType: "generic" });
    expect(chain).not.toBeNull();
    expect(chain!.dof).toBe(3); // 3 revolute joints (base fixed carrier not counted)
    // shoulder limit ±π (radians, unscaled).
    const shoulder = chain!.joints.find((j) => j.name === "shoulder")!;
    expect(shoulder.type).toBe("revolute");
    expect(shoulder.limits?.min).toBeCloseTo(-3.14159, 4);
    expect(shoulder.local).toBeDefined();
    // link1 BV is an AABB derived from the box geometry (mm): box 0.06×0.06×0.3 at z=0.15m.
    const link1 = chain!.joints.find((j) => j.name === "shoulder")!; // shoulder carries link1
    expect(link1.bv.kind).toBe("aabb");
  });

  it("FK on the derived chain reproduces the URDF rest reach (mm)", () => {
    const robot = parseUrdf(SAMPLE_URDF_3DOF_ARM);
    const chain = urdfToKinematicChain(robot)!;
    // At all-zero joints, the tool_link origin should be at the summed z-offsets:
    // 0.1 (shoulder) + 0.3 (elbow) + 0.25 (wrist) = 0.65 m = 650 mm along Z.
    const poses = forwardKinematics(chain, [0, 0, 0]);
    const tool = poses[poses.length - 1];
    expect(tool.origin[2]).toBeCloseTo(650, 3);
    expect(tool.origin[0]).toBeCloseTo(0, 3);
    expect(tool.origin[1]).toBeCloseTo(0, 3);
  });

  it("T2b consumes the real chain: a colliding program FAILS the gate", () => {
    const robot = parseUrdf(SAMPLE_URDF_3DOF_ARM);
    const chain = urdfToKinematicChain(robot)!;
    // Place an obstacle right on the tool at the rest pose (≈ [0,0,650] mm).
    const obstacle: Obstacle = { id: "box", volume: { kind: "sphere", center: [0, 0, 650], radius: 80 } };
    const scene: SimScene = { obstacles: [obstacle], safetyZones: [] };
    const flow = {
      flow_id: "f",
      target_device_type: "generic" as const,
      version: 1,
      blocks: [{ type: "move_joint" as const, joints: [0, 0, 0], speed_pct: 50 }],
    };
    const res = runKinematicSimGate(flow, chain, scene, { waypointResolution: 2 });
    expect(res.collision_events.length).toBeGreaterThan(0);
    expect(res.pass).toBe(false);
  });

  it("a joint-limit-exceeding program on the real chain FAILS the gate", () => {
    const robot = parseUrdf(SAMPLE_URDF_3DOF_ARM);
    const chain = urdfToKinematicChain(robot)!;
    const scene: SimScene = { obstacles: [], safetyZones: [] };
    // wrist limit is ±1.5708; command 3.0 rad → violation.
    const flow = {
      flow_id: "f",
      target_device_type: "generic" as const,
      version: 1,
      blocks: [{ type: "move_joint" as const, joints: [0, 0, 3.0], speed_pct: 50 }],
    };
    const res = runKinematicSimGate(flow, chain, scene, { waypointResolution: 2 });
    expect(res.joint_limit_violations.length).toBeGreaterThan(0);
    expect(res.pass).toBe(false);
  });

  it("returns null for a link-less robot (honest)", () => {
    expect(urdfToKinematicChain(parseUrdf("<robot/>"))).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CONVERSION SERVICE + registry (fake db, real filesystem in a temp dir)
// ════════════════════════════════════════════════════════════════════════════

// Fake db keyed on real drizzle column .name (same trick as twin.t1.test.ts).
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  desc: (col: any) => ({ __desc: col?.name }),
}));

const store: { equipment_3d_models: any[] } = { equipment_3d_models: [] };
let idSeq = 0;

function tableName(t: any): string {
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}
function matchEq(row: any, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "and") return pred.__ps.every((p: any) => matchEq(row, p));
  return true;
}

const fakeDb = {
  select() {
    return {
      from(t: any) {
        const rows = store[tableName(t) as "equipment_3d_models"] ?? [];
        const api = {
          where(pred: any) {
            const filtered = rows.filter((r) => matchEq(r, pred));
            return { limit: () => filtered.slice(0, 1), orderBy: () => ({ limit: () => filtered }) , then: undefined } as any;
          },
        };
        return api;
      },
    };
  },
  insert(t: any) {
    return {
      values(v: any) {
        const row = { id: ++idSeq, ...v };
        store[tableName(t) as "equipment_3d_models"].push(row);
        return { returning: () => [{ id: row.id }] };
      },
    };
  },
  update(t: any) {
    return {
      set(patch: any) {
        return {
          where(pred: any) {
            for (const r of store[tableName(t) as "equipment_3d_models"]) if (matchEq(r, pred)) Object.assign(r, patch);
            return Promise.resolve();
          },
        };
      },
    };
  },
};

// modelRegistry.ts (server/services/twin/) imports "../../db/connection" → server/db/connection.
// From THIS test file (…/twin/pipeline/) the same module is "../../../db/connection".
vi.mock("../../../db/connection", () => ({ getDb: async () => fakeDb }));

let tmpDir: string;

describe("T2a · conversion service + registry", () => {
  beforeEach(() => {
    store.equipment_3d_models = [];
    idSeq = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "t2a-"));
    process.env.LOCAL_STORAGE_DIR = tmpDir;
    delete process.env.MODEL_PIPELINE_ENABLED;
  });
  afterEach(() => {
    delete process.env.MODEL_PIPELINE_ENABLED;
    delete process.env.LOCAL_STORAGE_DIR;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("flag OFF → no-op (writes nothing)", async () => {
    const { convertUrdfModel } = await import("./modelConversionService");
    const r = await convertUrdfModel({ urdfSource: SAMPLE_URDF_3DOF_ARM, modelKey: "k1" });
    expect(r.status).toBe("disabled");
    expect(store.equipment_3d_models).toHaveLength(0);
  });

  it("flag ON → writes a real .gltf and a 'ready' registry row", async () => {
    process.env.MODEL_PIPELINE_ENABLED = "true";
    const { convertUrdfModel } = await import("./modelConversionService");
    const r = await convertUrdfModel({
      urdfSource: SAMPLE_URDF_3DOF_ARM,
      modelKey: "arm1",
      equipmentClass: "ROBOT",
    });
    expect(r.status).toBe("ready");
    expect(r.modelUri).toBe("/uploads/models/urdf/arm1.gltf");
    // real file on disk, parseable glTF.
    const filePath = path.join(tmpDir, "models/urdf/arm1.gltf");
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(parsed.asset.version).toBe("2.0");
    // registry row is 'ready' with sourceFormat 'urdf'.
    const row = store.equipment_3d_models[0];
    expect(row.conversionStatus).toBe("ready");
    expect(row.sourceFormat).toBe("urdf");
    expect(row.modelUri).toBe("/uploads/models/urdf/arm1.gltf");
    expect(row.bounds).toBeDefined();
  });

  it("bad URDF → 'failed' registry row (never 'ready'), honest error", async () => {
    process.env.MODEL_PIPELINE_ENABLED = "true";
    const { convertUrdfModel } = await import("./modelConversionService");
    const r = await convertUrdfModel({ urdfSource: `<robot name="x"></robot>`, modelKey: "bad1" });
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/no <link>/i);
    const row = store.equipment_3d_models[0];
    expect(row.conversionStatus).toBe("failed");
    expect(row.modelUri).toBe("");
  });

  it("STEP seam → 'pending' (phase-2), NOT faked as ready", async () => {
    process.env.MODEL_PIPELINE_ENABLED = "true";
    const { convertStepModel } = await import("./modelConversionService");
    const r = await convertStepModel({ modelKey: "step1", sourceFormat: "step" });
    expect(r.status).toBe("pending");
    expect(r.message).toMatch(/CAD kernel|occt|assimp/i);
    const row = store.equipment_3d_models[0];
    expect(row.conversionStatus).toBe("pending");
    expect(row.modelUri).toBe("");
  });

  it("also converts the 2-DOF planar sample end-to-end", async () => {
    process.env.MODEL_PIPELINE_ENABLED = "true";
    const { convertUrdfModel } = await import("./modelConversionService");
    const r = await convertUrdfModel({ urdfSource: SAMPLE_URDF_2DOF_PLANAR, modelKey: "planar1" });
    expect(r.status).toBe("ready");
    expect(r.meshCount).toBeGreaterThanOrEqual(2);
  });
});
