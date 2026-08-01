/**
 * Doc 22 P5 (Khối 7) — REAL glTF twin-asset + model-resolution fallback tests.
 *
 * Two independent guarantees the P5 change relies on:
 *
 *   1) SERVED ASSET IS REAL glTF 2.0 — the files shipped in client/public/models/ (served
 *      by Vite at /models/*.gltf, and copied into dist/public on build) are structurally
 *      valid glTF 2.0: asset.version === "2.0", ≥1 mesh, ≥1 node, an embedded binary buffer,
 *      and every mesh primitive references POSITION/NORMAL/indices accessors with min/max on
 *      POSITION (drei/three require it). We ALSO re-derive each asset from its source URDF via
 *      the same urdfToGltf emitter and assert the committed bytes match — so a stale committed
 *      asset (someone edits the URDF but forgets to regenerate) fails CI, not silently ships.
 *
 *   2) RESOLUTION FALLS BACK GRACEFULLY — when NO model row matches an equipment, resolveModel
 *      returns null so the DigitalTwinCenter renders its coloured block (unmodeled devices must
 *      never break). Verified with an in-memory fake db (no real DB needed).
 *
 * Pure + hermetic: reads files from disk + a fake db. No flag, no network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseUrdf } from "./pipeline/urdfParser";
import { urdfToGltf } from "./pipeline/urdfToGltf";
import { SAMPLE_URDF_AOI_MACHINE, SAMPLE_URDF_3DOF_ARM } from "./pipeline/sampleUrdfs";

const MODELS_DIR = path.resolve(__dirname, "../../../client/public/models");

// The served assets and the URDF each is generated from (scripts/generate-twin-gltf.mts).
const SERVED_ASSETS: Array<{ file: string; urdf: string }> = [
  { file: "aoi-machine.gltf", urdf: SAMPLE_URDF_AOI_MACHINE },
  { file: "robot-arm.gltf", urdf: SAMPLE_URDF_3DOF_ARM },
];

// ════════════════════════════════════════════════════════════════════════════
// 1) The SERVED glTF assets are structurally valid glTF 2.0
// ════════════════════════════════════════════════════════════════════════════
describe("P5 · served twin glTF assets are valid glTF 2.0", () => {
  for (const { file } of SERVED_ASSETS) {
    it(`${file} is a structurally valid glTF 2.0 with real geometry`, () => {
      const p = path.join(MODELS_DIR, file);
      expect(fs.existsSync(p)).toBe(true);
      const g = JSON.parse(fs.readFileSync(p, "utf8"));

      // Core glTF 2.0 shape.
      expect(g.asset?.version).toBe("2.0");
      expect(typeof g.scene).toBe("number");
      expect(Array.isArray(g.scenes)).toBe(true);
      expect(Array.isArray(g.scenes[0].nodes)).toBe(true);
      expect(g.scenes[0].nodes.length).toBeGreaterThan(0);

      // At least one mesh AND one node (task acceptance criteria).
      expect(Array.isArray(g.meshes)).toBe(true);
      expect(g.meshes.length).toBeGreaterThan(0);
      expect(Array.isArray(g.nodes)).toBe(true);
      expect(g.nodes.length).toBeGreaterThan(0);

      // A single, self-contained embedded binary buffer (base64 data-URI).
      expect(Array.isArray(g.buffers)).toBe(true);
      expect(g.buffers.length).toBe(1);
      expect(String(g.buffers[0].uri)).toMatch(/^data:application\/octet-stream;base64,/);
      expect(g.buffers[0].byteLength).toBeGreaterThan(0);

      // Every mesh primitive references real geometry (POSITION+NORMAL+indices), and the
      // POSITION accessor carries min/max (drei/three require it or the model won't load).
      for (const m of g.meshes) {
        const prim = m.primitives[0];
        expect(prim.attributes.POSITION).toBeTypeOf("number");
        expect(prim.attributes.NORMAL).toBeTypeOf("number");
        expect(prim.indices).toBeTypeOf("number");
        const pos = g.accessors[prim.attributes.POSITION];
        expect(pos.type).toBe("VEC3");
        expect(pos.min).toHaveLength(3);
        expect(pos.max).toHaveLength(3);
        expect(pos.count).toBeGreaterThan(0);
      }

      // bufferView offsets are 4-byte aligned and inside the buffer.
      const total = g.buffers[0].byteLength;
      for (const bv of g.bufferViews) {
        expect(bv.byteOffset % 4).toBe(0);
        expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(total);
      }
    });
  }

  it("served bytes match a fresh urdfToGltf regeneration (asset is not stale)", () => {
    for (const { file, urdf } of SERVED_ASSETS) {
      const served = fs.readFileSync(path.join(MODELS_DIR, file), "utf8");
      const fresh = urdfToGltf(parseUrdf(urdf)).json;
      expect(served).toBe(fresh);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2) Model resolution falls back gracefully when no row matches (→ FE block)
// ════════════════════════════════════════════════════════════════════════════

// Fake db keyed on real drizzle column .name (same trick as twin.t1.test.ts).
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  inArray: (col: any, vals: any[]) => ({ __op: "inArray", __k: col?.name, __vals: vals }),
  desc: (col: any) => ({ __desc: col?.name }),
  asc: (col: any) => ({ __asc: col?.name }),
  sql: () => ({}),
}));

type Row = Record<string, any>;
const store: Record<string, Row[]> = { equipment_3d_models: [] };
function tableName(t: any): string {
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
const fakeDb = {
  select: () => ({
    from: (t: any) => {
      const rows = store[tableName(t)] ?? [];
      let pred: any = null;
      const q: any = {
        where: (p: any) => { pred = p; return q; },
        orderBy: () => q,
        limit: async (n: number) => rows.filter((r) => matches(r, pred)).slice(0, n),
        then: (resolve: any) => resolve(rows.filter((r) => matches(r, pred))),
      };
      return q;
    },
  }),
};
vi.mock("../../db/connection", () => ({ getDb: async () => fakeDb }));

import { resolveModel, pickBestModel } from "./modelRegistry";

describe("P5 · model resolution graceful fallback", () => {
  beforeEach(() => { store.equipment_3d_models = []; });

  it("resolveModel returns null when NO model row exists (FE renders the block)", async () => {
    const r = await resolveModel({ machineId: 42, equipmentClass: "AOI" });
    expect(r).toBeNull();
  });

  it("resolveModel returns null when rows exist but none match the target", async () => {
    store.equipment_3d_models.push({
      id: 1, status: "active", version: 1, conversionStatus: "ready",
      modelUri: "/models/robot-arm.gltf", equipmentClass: "ROBOT",
      machineId: null, equipmentId: null,
    });
    // A machine of an UNRELATED class → no class/id/equipmentId match → null.
    const r = await resolveModel({ machineId: 7, equipmentClass: "AOI" });
    expect(r).toBeNull();
  });

  it("resolveModel returns the real registered asset URI when a row DOES match", async () => {
    store.equipment_3d_models.push({
      id: 1, status: "active", version: 1, conversionStatus: "ready",
      modelUri: "/models/robot-arm.gltf", equipmentClass: "ROBOT",
      machineId: null, equipmentId: null,
    });
    const r = await resolveModel({ equipmentId: "3", equipmentClass: "ROBOT" });
    expect(r?.modelUri).toBe("/models/robot-arm.gltf");
  });

  it("pickBestModel (pure) returns null for an empty candidate set", () => {
    expect(pickBestModel({ machineId: 1, equipmentClass: "AOI" }, [])).toBeNull();
  });
});
