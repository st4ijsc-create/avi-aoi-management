/**
 * T4 (doc 24 Wave-3) — STEP/CAD → glTF conversion tests.
 *
 * Covers:
 *   • stepToGltf: a real hand-authored B-Rep cube (10 mm) → glTF with non-empty
 *     vertices/indices, correct mm→m scaling (bbox ≈ 0.01 m) and a bounding box.
 *   • convertStepModel: flag-off no-op; a valid STEP → a real .gltf file + a 'ready'
 *     registry row (sourceFormat 'step', bounds in m); a bad STEP → a 'failed' row +
 *     an honest reason (never 'ready', never fabricated); no source → the honest
 *     'pending' seam.
 *   • Wiring: a STEP-origin 'ready' row is pickable by the scene-graph resolve path
 *     (pickBestModel) and reports renderable.
 *
 * ── occt WASM AVAILABILITY GATE ─────────────────────────────────────────────
 * The geometry asserts need the OpenCASCADE WASM to init. We probe ONCE at module
 * load; if it cannot init in the sandbox we SKIP the geometry asserts (clearly
 * logged) but STILL exercise the failure/degrade + registry wiring paths, which do
 * not need the kernel. This mirrors the guard that keeps `check`/`build` WASM-free.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { stepBufferToGltf, occtAvailable } from "./stepToGltf";
import { pickBestModel, isModelRenderable, type ResolveTarget } from "../modelRegistry";

// A VALID minimal ISO-10303-21 STEP: a 10 mm B-Rep cube (8 verts, 6 planar faces,
// closed shell). Verified to tessellate under occt (1 solid, 12 triangles).
const CUBE_STEP = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('cube'),'2;1');
FILE_NAME('cube.step','2026-01-01T00:00:00',(''),(''),'occt','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.,0.,0.));
#2 = CARTESIAN_POINT('',(10.,0.,0.));
#3 = CARTESIAN_POINT('',(10.,10.,0.));
#4 = CARTESIAN_POINT('',(0.,10.,0.));
#5 = CARTESIAN_POINT('',(0.,0.,10.));
#6 = CARTESIAN_POINT('',(10.,0.,10.));
#7 = CARTESIAN_POINT('',(10.,10.,10.));
#8 = CARTESIAN_POINT('',(0.,10.,10.));
#11 = VERTEX_POINT('',#1);
#12 = VERTEX_POINT('',#2);
#13 = VERTEX_POINT('',#3);
#14 = VERTEX_POINT('',#4);
#15 = VERTEX_POINT('',#5);
#16 = VERTEX_POINT('',#6);
#17 = VERTEX_POINT('',#7);
#18 = VERTEX_POINT('',#8);
#30 = DIRECTION('',(1.,0.,0.));
#31 = DIRECTION('',(0.,1.,0.));
#32 = DIRECTION('',(0.,0.,1.));
#40 = VECTOR('',#30,1.);
#41 = VECTOR('',#31,1.);
#42 = VECTOR('',#32,1.);
#51 = LINE('',#1,#40);
#52 = LINE('',#2,#41);
#53 = LINE('',#4,#40);
#54 = LINE('',#1,#41);
#55 = LINE('',#5,#40);
#56 = LINE('',#6,#41);
#57 = LINE('',#8,#40);
#58 = LINE('',#5,#41);
#59 = LINE('',#1,#42);
#60 = LINE('',#2,#42);
#61 = LINE('',#3,#42);
#62 = LINE('',#4,#42);
#71 = EDGE_CURVE('',#11,#12,#51,.T.);
#72 = EDGE_CURVE('',#12,#13,#52,.T.);
#73 = EDGE_CURVE('',#13,#14,#53,.T.);
#74 = EDGE_CURVE('',#14,#11,#54,.T.);
#75 = EDGE_CURVE('',#15,#16,#55,.T.);
#76 = EDGE_CURVE('',#16,#17,#56,.T.);
#77 = EDGE_CURVE('',#17,#18,#57,.T.);
#78 = EDGE_CURVE('',#18,#15,#58,.T.);
#79 = EDGE_CURVE('',#11,#15,#59,.T.);
#80 = EDGE_CURVE('',#12,#16,#60,.T.);
#81 = EDGE_CURVE('',#13,#17,#61,.T.);
#82 = EDGE_CURVE('',#14,#18,#62,.T.);
#101 = ORIENTED_EDGE('',*,*,#71,.T.);
#102 = ORIENTED_EDGE('',*,*,#72,.T.);
#103 = ORIENTED_EDGE('',*,*,#73,.T.);
#104 = ORIENTED_EDGE('',*,*,#74,.T.);
#105 = ORIENTED_EDGE('',*,*,#75,.T.);
#106 = ORIENTED_EDGE('',*,*,#76,.T.);
#107 = ORIENTED_EDGE('',*,*,#77,.T.);
#108 = ORIENTED_EDGE('',*,*,#78,.T.);
#109 = ORIENTED_EDGE('',*,*,#71,.T.);
#110 = ORIENTED_EDGE('',*,*,#80,.T.);
#111 = ORIENTED_EDGE('',*,*,#75,.F.);
#112 = ORIENTED_EDGE('',*,*,#79,.F.);
#113 = ORIENTED_EDGE('',*,*,#72,.T.);
#114 = ORIENTED_EDGE('',*,*,#81,.T.);
#115 = ORIENTED_EDGE('',*,*,#76,.F.);
#116 = ORIENTED_EDGE('',*,*,#80,.F.);
#117 = ORIENTED_EDGE('',*,*,#73,.T.);
#118 = ORIENTED_EDGE('',*,*,#82,.T.);
#119 = ORIENTED_EDGE('',*,*,#77,.F.);
#120 = ORIENTED_EDGE('',*,*,#81,.F.);
#121 = ORIENTED_EDGE('',*,*,#74,.T.);
#122 = ORIENTED_EDGE('',*,*,#79,.T.);
#123 = ORIENTED_EDGE('',*,*,#78,.F.);
#124 = ORIENTED_EDGE('',*,*,#82,.F.);
#131 = EDGE_LOOP('',(#101,#102,#103,#104));
#132 = EDGE_LOOP('',(#105,#106,#107,#108));
#133 = EDGE_LOOP('',(#109,#110,#111,#112));
#134 = EDGE_LOOP('',(#113,#114,#115,#116));
#135 = EDGE_LOOP('',(#117,#118,#119,#120));
#136 = EDGE_LOOP('',(#121,#122,#123,#124));
#141 = FACE_OUTER_BOUND('',#131,.T.);
#142 = FACE_OUTER_BOUND('',#132,.T.);
#143 = FACE_OUTER_BOUND('',#133,.T.);
#144 = FACE_OUTER_BOUND('',#134,.T.);
#145 = FACE_OUTER_BOUND('',#135,.T.);
#146 = FACE_OUTER_BOUND('',#136,.T.);
#151 = AXIS2_PLACEMENT_3D('',#1,#32,#30);
#152 = AXIS2_PLACEMENT_3D('',#5,#32,#30);
#153 = AXIS2_PLACEMENT_3D('',#1,#31,#30);
#154 = AXIS2_PLACEMENT_3D('',#2,#30,#31);
#155 = AXIS2_PLACEMENT_3D('',#4,#31,#30);
#156 = AXIS2_PLACEMENT_3D('',#1,#30,#31);
#161 = PLANE('',#151);
#162 = PLANE('',#152);
#163 = PLANE('',#153);
#164 = PLANE('',#154);
#165 = PLANE('',#155);
#166 = PLANE('',#156);
#171 = ADVANCED_FACE('',(#141),#161,.F.);
#172 = ADVANCED_FACE('',(#142),#162,.T.);
#173 = ADVANCED_FACE('',(#143),#163,.F.);
#174 = ADVANCED_FACE('',(#144),#164,.T.);
#175 = ADVANCED_FACE('',(#145),#165,.T.);
#176 = ADVANCED_FACE('',(#146),#166,.F.);
#180 = CLOSED_SHELL('',(#171,#172,#173,#174,#175,#176));
#181 = MANIFOLD_SOLID_BREP('cube',#180);
#301 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#302 = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
#303 = ( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() );
#304 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#301,'distance_accuracy_value','confusion accuracy');
#210 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#304)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#301,#302,#303)) REPRESENTATION_CONTEXT('Context','3D') );
#220 = ADVANCED_BREP_SHAPE_REPRESENTATION('cube',(#181),#210);
#200 = APPLICATION_CONTEXT('automotive design');
#201 = APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#200);
#202 = PRODUCT_CONTEXT('',#200,'mechanical');
#203 = PRODUCT('Cube','Cube','',(#202));
#204 = PRODUCT_DEFINITION_FORMATION('','',#203);
#205 = PRODUCT_DEFINITION_CONTEXT('part definition',#200,'design');
#206 = PRODUCT_DEFINITION('design','',#204,#205);
#207 = PRODUCT_DEFINITION_SHAPE('','',#206);
#221 = SHAPE_DEFINITION_REPRESENTATION(#207,#220);
#208 = PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#203));
ENDSEC;
END-ISO-10303-21;`;

// Probe once — the geometry asserts run only if the WASM can init here.
const OCCT_AVAILABLE = await occtAvailable();
if (!OCCT_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn("[T4] occt-import-js WASM did not init in this sandbox — geometry asserts SKIPPED; degrade + wiring still tested.");
}
const itOcct = OCCT_AVAILABLE ? it : it.skip;

// ════════════════════════════════════════════════════════════════════════════
// PURE stepToGltf (no db, no fs)
// ════════════════════════════════════════════════════════════════════════════
describe("T4 · stepToGltf (occt-import-js)", () => {
  itOcct("tessellates a 10 mm cube → glTF with non-empty vertices/indices + bbox (mm→m)", async () => {
    const out = await stepBufferToGltf(new TextEncoder().encode(CUBE_STEP), { sourceFormat: "step" });
    expect(out.solidCount).toBeGreaterThanOrEqual(1);
    expect(out.triangleCount).toBeGreaterThanOrEqual(12); // a cube = 6 faces * 2 tris
    expect(out.unit).toBe("m");

    const g = out.gltf as any;
    expect(g.asset.version).toBe("2.0");
    expect(g.meshes.length).toBeGreaterThanOrEqual(1);
    const prim = g.meshes[0].primitives[0];
    const pos = g.accessors[prim.attributes.POSITION];
    const idx = g.accessors[prim.indices];
    expect(pos.count).toBeGreaterThan(0); // non-empty vertices
    expect(idx.count).toBeGreaterThan(0); // non-empty indices
    expect(pos.min).toHaveLength(3);
    expect(pos.max).toHaveLength(3);

    // 10 mm cube → 0.01 m extent on each axis (mm→m scaling proven).
    for (let a = 0; a < 3; a++) {
      expect(out.bounds.max[a] - out.bounds.min[a]).toBeCloseTo(0.01, 5);
    }
  });

  it("throws (never fabricates) on an invalid STEP", async () => {
    await expect(stepBufferToGltf(new TextEncoder().encode("this is not a step file"))).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// convertStepModel + registry (fake db, real fs in a temp dir) — mirrors t2a test
// ════════════════════════════════════════════════════════════════════════════
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
        return {
          where(pred: any) {
            const filtered = rows.filter((r) => matchEq(r, pred));
            return { limit: () => filtered.slice(0, 1), orderBy: () => ({ limit: () => filtered }) } as any;
          },
        };
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

// modelRegistry.ts (server/services/twin/) imports "../../db/connection"; from THIS file
// (…/twin/pipeline/) it resolves as "../../../db/connection".
vi.mock("../../../db/connection", () => ({ getDb: async () => fakeDb }));

let tmpDir: string;

describe("T4 · convertStepModel + registry", () => {
  beforeEach(() => {
    store.equipment_3d_models = [];
    idSeq = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "t4-"));
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

  it("flag OFF → disabled no-op (writes nothing), even with a source", async () => {
    const { convertStepModel } = await import("./modelConversionService");
    const r = await convertStepModel({ modelKey: "s0", sourceFormat: "step", stepSource: CUBE_STEP });
    expect(r.status).toBe("disabled");
    expect(store.equipment_3d_models).toHaveLength(0);
  });

  it("no source → honest 'pending' seam (never faked)", async () => {
    process.env.MODEL_PIPELINE_ENABLED = "true";
    const { convertStepModel } = await import("./modelConversionService");
    const r = await convertStepModel({ modelKey: "s-seam", sourceFormat: "step" });
    expect(r.status).toBe("pending");
    expect(r.message).toMatch(/occt|CAD kernel/i);
    const row = store.equipment_3d_models[0];
    expect(row.conversionStatus).toBe("pending");
    expect(row.modelUri).toBe("");
  });

  it("invalid STEP → 'failed' row + honest reason (never 'ready', no crash)", async () => {
    process.env.MODEL_PIPELINE_ENABLED = "true";
    const { convertStepModel } = await import("./modelConversionService");
    const r = await convertStepModel({ modelKey: "s-bad", sourceFormat: "step", stepSource: "not a real step file" });
    expect(r.status).toBe("failed");
    expect(r.ok).toBe(false);
    expect(typeof r.message).toBe("string");
    expect((r.message ?? "").length).toBeGreaterThan(0);
    const row = store.equipment_3d_models[0];
    expect(row.conversionStatus).toBe("failed");
    expect(row.modelUri).toBe("");
  });

  itOcct("valid STEP → real .gltf on disk + 'ready' registry row (sourceFormat step, bounds m)", async () => {
    process.env.MODEL_PIPELINE_ENABLED = "true";
    const { convertStepModel } = await import("./modelConversionService");
    const r = await convertStepModel({
      modelKey: "cube1",
      sourceFormat: "step",
      stepSource: CUBE_STEP,
      equipmentClass: "AOI",
    });
    expect(r.status).toBe("ready");
    expect(r.modelUri).toBe("/uploads/models/step/cube1.gltf");
    expect(r.solidCount).toBeGreaterThanOrEqual(1);
    expect(r.triangleCount).toBeGreaterThanOrEqual(12);

    // Real, parseable glTF on disk with non-empty geometry.
    const filePath = path.join(tmpDir, "models/step/cube1.gltf");
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(parsed.asset.version).toBe("2.0");
    const prim = parsed.meshes[0].primitives[0];
    expect(parsed.accessors[prim.attributes.POSITION].count).toBeGreaterThan(0);
    expect(parsed.accessors[prim.indices].count).toBeGreaterThan(0);

    // Registry row is 'ready' with STEP provenance + bounds in metres.
    const row = store.equipment_3d_models[0];
    expect(row.conversionStatus).toBe("ready");
    expect(row.sourceFormat).toBe("step");
    expect(row.modelUri).toBe("/uploads/models/step/cube1.gltf");
    expect(row.bounds).toBeDefined();
    expect(row.bounds.unit).toBe("m");
  });

  itOcct("the converted STEP model is pickable by the scene-graph resolve path", async () => {
    process.env.MODEL_PIPELINE_ENABLED = "true";
    const { convertStepModel } = await import("./modelConversionService");
    await convertStepModel({ modelKey: "cube2", sourceFormat: "step", stepSource: CUBE_STEP, equipmentClass: "AOI" });

    const target: ResolveTarget = { equipmentClass: "AOI" };
    const best = pickBestModel(target, store.equipment_3d_models as any);
    expect(best).not.toBeNull();
    expect(best!.modelUri).toBe("/uploads/models/step/cube2.gltf");
    expect(isModelRenderable(best as any)).toBe(true);
  });

  it("wiring is kernel-independent: a STEP-origin 'ready' row registers + resolves + is renderable", async () => {
    // Prove the registry → scene-graph pick path for a STEP-provenance row WITHOUT needing occt.
    const { registerModel } = await import("../modelRegistry");
    const reg = await registerModel({
      modelKey: "syn-step",
      modelUri: "/uploads/models/step/syn-step.gltf",
      equipmentClass: "AOI",
      modelKind: "gltf",
      sourceFormat: "step",
      conversionStatus: "ready",
      bounds: { min: [0, 0, 0], max: [0.01, 0.01, 0.01], unit: "m" },
    });
    expect(reg.ok).toBe(true);
    const best = pickBestModel({ equipmentClass: "AOI" }, store.equipment_3d_models as any);
    expect(best).not.toBeNull();
    expect(best!.sourceFormat).toBe("step");
    expect(isModelRenderable(best as any)).toBe(true);
  });
});
