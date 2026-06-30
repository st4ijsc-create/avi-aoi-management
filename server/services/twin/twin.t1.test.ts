/**
 * T1 (doc 16 Khối 7) — Digital Twin backend tests.
 *
 * Layers (mirrors fleet.g1/g2 style):
 *   • PURE: model resolve precedence (pickBestModel), occupancy-grid build + A*
 *     (finds a path around an obstacle, returns null when fully blocked),
 *     scene-graph assembly (zone→line→station→device nesting + live-status merge),
 *     replay downsampling math (computeEffectiveStep) + fold ordering,
 *     twin-stream rowToDelta mapping.
 *   • DB-FLOW (in-memory fake db keyed on real drizzle column .name): model
 *     register idempotency + version bump + resolve.
 *   • FLAG-OFF: streaming gateway tap registers nothing emit-worthy + register
 *     mutation gating is enforced at the service flag.
 *
 * The fake db is self-contained (no real DB) so these run in any environment. We mock
 * drizzle-orm predicate helpers to capture column .name (same trick as fleet.g1).
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

type Row = Record<string, any>;
const store: Record<string, Row[]> = { equipment_3d_models: [] };
const seq: Record<string, number> = {};
function nextId(table: string): number { seq[table] = (seq[table] ?? 0) + 1; return seq[table]; }
function reset() { for (const k of Object.keys(store)) store[k] = []; for (const k of Object.keys(seq)) seq[k] = 0; }

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
function makeFakeDb() {
  const select = () => ({
    from: (t: any) => {
      const name = tableName(t);
      let pred: any = null; let order: any = null;
      const q: any = {
        where: (p: any) => { pred = p; return q; },
        orderBy: (o: any) => { order = o; return q; },
        limit: async (n: number) => run().slice(0, n),
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
  return {
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
}
vi.mock("../../db/connection", () => ({ getDb: async () => makeFakeDb() }));

import { pickBestModel, registerModel, resolveModel, isModelRenderable } from "./modelRegistry";
import { buildGrid, planPathOnGrid, worldToCell, makeEmptyGrid } from "./occupancyGrid";
import { assembleSceneGraph } from "./sceneGraph";
import { foldSnapshots, computeEffectiveStep } from "./twinReplay";
import { rowToDelta } from "./twinStream";

beforeEach(() => {
  reset();
  delete process.env.TWIN_LIVE_ENABLED;
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — model resolve precedence
// ════════════════════════════════════════════════════════════════════════════
describe("pickBestModel (resolve precedence)", () => {
  const base = { status: "active", version: 1, modelUri: "x.glb", conversionStatus: "ready" } as any;
  it("machineId match beats equipmentId match beats class match", () => {
    const cands = [
      { ...base, id: 1, equipmentClass: "AOI" },
      { ...base, id: 2, equipmentId: "robot:3" },
      { ...base, id: 3, machineId: 12 },
    ];
    const m = pickBestModel({ machineId: 12, equipmentId: "robot:3", equipmentClass: "AOI" }, cands);
    expect(m?.id).toBe(3);
  });
  it("falls back to class when no specific match", () => {
    const cands = [{ ...base, id: 1, equipmentClass: "AOI" }];
    const m = pickBestModel({ machineId: 99, equipmentClass: "AOI" }, cands);
    expect(m?.id).toBe(1);
  });
  it("prefers higher version among class ties", () => {
    const cands = [
      { ...base, id: 1, equipmentClass: "ROBOT", version: 1 },
      { ...base, id: 2, equipmentClass: "ROBOT", version: 3 },
    ];
    const m = pickBestModel({ equipmentClass: "ROBOT" }, cands);
    expect(m?.id).toBe(2);
  });
  it("ignores archived rows", () => {
    const cands = [{ ...base, id: 1, machineId: 5, status: "archived" }];
    expect(pickBestModel({ machineId: 5 }, cands)).toBeNull();
  });
  it("isModelRenderable: only ready/external active rows with a uri", () => {
    expect(isModelRenderable({ status: "active", conversionStatus: "ready", modelUri: "a.glb" })).toBe(true);
    expect(isModelRenderable({ status: "active", conversionStatus: "pending", modelUri: "a.glb" })).toBe(false);
    expect(isModelRenderable({ status: "archived", conversionStatus: "ready", modelUri: "a.glb" })).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — model register idempotency + version bump + resolve
// ════════════════════════════════════════════════════════════════════════════
describe("registerModel + resolveModel (db-flow)", () => {
  it("creates once, re-register bumps version in place (idempotent on modelKey)", async () => {
    const a = await registerModel({ modelKey: "m:aoi", modelUri: "aoi.glb", equipmentClass: "AOI" });
    expect(a.created).toBe(true);
    expect(a.version).toBe(1);
    const b = await registerModel({ modelKey: "m:aoi", modelUri: "aoi-v2.glb", equipmentClass: "AOI" });
    expect(b.created).toBe(false);
    expect(b.version).toBe(2);
    expect(store.equipment_3d_models.length).toBe(1);
    expect(store.equipment_3d_models[0].modelUri).toBe("aoi-v2.glb");
  });

  it("resolveModel returns the class model for a machine of that class", async () => {
    await registerModel({ modelKey: "m:aoi", modelUri: "aoi.glb", equipmentClass: "AOI" });
    await registerModel({ modelKey: "m:m12", modelUri: "m12.glb", machineId: 12 });
    const byMachine = await resolveModel({ machineId: 12, equipmentClass: "AOI" });
    expect(byMachine?.modelUri).toBe("m12.glb");
    const byClass = await resolveModel({ machineId: 99, equipmentClass: "AOI" });
    expect(byClass?.modelUri).toBe("aoi.glb");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — occupancy grid + A*
// ════════════════════════════════════════════════════════════════════════════
describe("occupancy grid + A*", () => {
  it("worldToCell maps world coords to integer cells", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 10, rows: 10, cellSize: 1 });
    expect(worldToCell(g, { x: 2.4, y: 3.9 })).toEqual({ col: 2, row: 3 });
  });

  it("finds a path that routes AROUND a wall obstacle", () => {
    // 10x10 grid, 1m cells. A vertical wall at col 5 from row 0..8 leaves a gap at row 9.
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 10, rows: 10, cellSize: 1 });
    for (let r = 0; r <= 8; r++) g.cells[r][5] = true;
    const res = planPathOnGrid(g, { x: 0.5, y: 0.5 }, { x: 9.5, y: 0.5 });
    expect(res.ok).toBe(true);
    // The path must detour through the gap (row 9) — i.e. it visits a cell at row 9.
    expect(res.cells.some((c) => c.row === 9)).toBe(true);
    // And it never steps on an occupied wall cell.
    expect(res.cells.every((c) => !g.cells[c.row][c.col])).toBe(true);
  });

  it("returns no path when the goal is fully walled off", () => {
    const g = makeEmptyGrid({ originX: 0, originY: 0, cols: 6, rows: 6, cellSize: 1 });
    // Box the goal cell (5,5)'s only approaches: wall the entire col 4 and row 4.
    for (let r = 0; r < 6; r++) g.cells[r][4] = true;
    for (let c = 0; c < 6; c++) g.cells[4][c] = true;
    const res = planPathOnGrid(g, { x: 0.5, y: 0.5 }, { x: 5.5, y: 5.5 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no_path");
  });

  it("buildGrid marks an inflated obstacle's cells occupied", () => {
    const g = buildGrid({ originX: 0, originY: 0, cols: 10, rows: 10, cellSize: 1 }, [{ x: 2, y: 2, w: 2, h: 2, inflate: 0 }]);
    expect(g.cells[2][2]).toBe(true);
    expect(g.cells[3][3]).toBe(true);
    expect(g.cells[0][0]).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — scene graph assembly (nesting + live-status merge)
// ════════════════════════════════════════════════════════════════════════════
describe("assembleSceneGraph (nesting + status merge)", () => {
  it("nests zone/line/station/device and normalizes live status", () => {
    const sg = assembleSceneGraph({
      factory: { id: 1, code: "F1", name: "Factory 1" },
      zones: [{ id: 7, code: "Z7", name: "Cell A", zoneType: "production", maxConcurrentRobots: 2 }],
      lines: [{ id: 2, code: "L2", name: "Line 2", workshopId: 9 }],
      stations: [{ id: 5, code: "S5", name: "Station 5", lineId: 2 }],
      machines: [{ id: 12, code: "M12", name: "AOI 12", stationId: 5, operationStatus: "running", modelUri: "m12.glb" }],
      robots: [{ id: 3, code: "R3", name: "Cobot 3", stationId: 5, status: "estop", activeTaskId: 42 }],
    });
    expect(sg.zones).toHaveLength(1);
    expect(sg.lines).toHaveLength(1);
    expect(sg.lines[0].stations).toHaveLength(1);
    // device nesting under station
    const stationDevices = sg.lines[0].stations[0].devices;
    expect(stationDevices.map((d) => d.id).sort()).toEqual(["machine:12", "robot:3"]);
    // live-status merge: running machine + estopped robot
    const machine = sg.devices.find((d) => d.id === "machine:12")!;
    const robot = sg.devices.find((d) => d.id === "robot:3")!;
    expect(machine.state).toBe("running");
    expect(machine.modelUri).toBe("m12.glb");
    expect(robot.state).toBe("estop");
    expect(robot.activeTaskId).toBe(42);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — replay downsampling cap + fold ordering
// ════════════════════════════════════════════════════════════════════════════
describe("replay downsampling + fold", () => {
  it("computeEffectiveStep widens step so frames stay under the cap", () => {
    // 1 hour window (3600s), requested 1s step, 10 devices, cap 1000 frames.
    // 3600 buckets * 10 = 36000 > 1000 → must widen.
    const step = computeEffectiveStep(3600, 1, 10, 1000);
    expect(Math.ceil(3600 / step) * 10).toBeLessThanOrEqual(1000);
    expect(step).toBeGreaterThan(1);
  });

  it("computeEffectiveStep keeps the requested step when already under cap", () => {
    expect(computeEffectiveStep(60, 5, 2, 5000)).toBe(5);
  });

  it("foldSnapshots collapses metric rows per (device,bucket), ordered ascending", () => {
    const t0 = new Date("2026-06-30T00:00:00Z");
    const t1 = new Date("2026-06-30T00:00:05Z");
    const snaps = foldSnapshots([
      { bucket: t1, machineId: 1, deviceId: null, metric: "position_x", numValue: 9, textValue: null },
      { bucket: t0, machineId: 1, deviceId: null, metric: "position_x", numValue: 1, textValue: null },
      { bucket: t0, machineId: 1, deviceId: null, metric: "position_y", numValue: 2, textValue: null },
      { bucket: t0, machineId: 1, deviceId: null, metric: "packml_state", numValue: null, textValue: "Execute" },
    ]);
    expect(snaps).toHaveLength(2); // two buckets for device machine:1
    expect(snaps[0].timestamp).toBeLessThan(snaps[1].timestamp); // ascending
    expect(snaps[0].position).toEqual({ x: 1, y: 2 });
    expect(snaps[0].packMlState).toBe("Execute");
    expect(snaps[1].position).toEqual({ x: 9, y: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — twin-stream row→delta mapping
// ════════════════════════════════════════════════════════════════════════════
describe("twinStream rowToDelta", () => {
  it("maps position + state metrics, ignores others", () => {
    expect(rowToDelta({ machineId: 5, metric: "position_x", numValue: 3 } as any)).toEqual({ equipmentId: "machine:5", field: "x", value: 3 });
    expect(rowToDelta({ machineId: 5, metric: "packml_state", textValue: "Held" } as any)).toEqual({ equipmentId: "machine:5", field: "state", value: "Held" });
    expect(rowToDelta({ machineId: 5, metric: "temperature", numValue: 70 } as any)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FLAG-OFF — streaming gateway start is a no-op + register flag is off by default
// ════════════════════════════════════════════════════════════════════════════
describe("flag-off behavior", () => {
  it("startTwinStreamGateway is a no-op when TWIN_LIVE_ENABLED is off", async () => {
    const { startTwinStreamGateway, stopTwinStreamGateway, _pendingCount } = await import("./twinStream");
    startTwinStreamGateway(); // flag off → should not register a tap or timer
    expect(_pendingCount()).toBe(0);
    stopTwinStreamGateway();
  });

  it("twinLiveEnabled reflects the env flag", async () => {
    const { twinLiveEnabled } = await import("./modelRegistry");
    expect(twinLiveEnabled()).toBe(false);
    process.env.TWIN_LIVE_ENABLED = "true";
    expect(twinLiveEnabled()).toBe(true);
  });
});
