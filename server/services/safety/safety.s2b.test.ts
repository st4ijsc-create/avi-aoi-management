/**
 * S2b (doc 20 §2/§5) — Vision human-detection producer + Safety-PLC status adapter.
 *
 * Layers:
 *   • PURE homography: solve + apply round-trips known pixel↔floor pairs; identity;
 *     singular/degenerate rejection; residual metric.
 *   • PURE producer geometry: footPixel bottom-centre; detectionsToFloorHumans via H;
 *     backends (injected/none/onnx) — no-backend produces NOTHING (honesty).
 *   • PURE PLC mapping: statusToFindings maps active flags → advisory event types; sim
 *     backend cycles a script; all-clear script → no findings.
 *   • SERVICE (in-memory fake db): produce() injected detections → floor humans → S2a
 *     reactions (real evaluateAndRecord) + advisory events; flag-off no-op. safety-PLC
 *     sim backend → advisory events; real-endpoint path via a MOCKED OT driver;
 *     flag-off no-op.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ════════════════════════════════════════════════════════════════════════════
// PURE — homography (no mocks)
// ════════════════════════════════════════════════════════════════════════════
import {
  solveHomography,
  applyHomography,
  calibrationResidualMm,
  isHomography,
  type CalibrationPair,
  type Homography,
} from "./vision/homography";

describe("homography (PURE)", () => {
  // A simple affine (scale ×10, translate +100/+200) expressed as pixel↔floor pairs.
  const pairs: CalibrationPair[] = [
    { image: { u: 0, v: 0 }, floor: { x: 100, y: 200 } },
    { image: { u: 10, v: 0 }, floor: { x: 200, y: 200 } },
    { image: { u: 0, v: 10 }, floor: { x: 100, y: 300 } },
    { image: { u: 10, v: 10 }, floor: { x: 200, y: 300 } },
  ];

  it("solve + apply reproduces the calibration pairs (residual ≈ 0)", () => {
    const H = solveHomography(pairs);
    for (const p of pairs) {
      const f = applyHomography(H, p.image);
      expect(f.x).toBeCloseTo(p.floor.x, 4);
      expect(f.y).toBeCloseTo(p.floor.y, 4);
    }
    expect(calibrationResidualMm(H, pairs)).toBeLessThan(1e-6);
  });

  it("solved H generalizes to an interior point (midpoint → floor midpoint)", () => {
    const H = solveHomography(pairs);
    const mid = applyHomography(H, { u: 5, v: 5 });
    expect(mid.x).toBeCloseTo(150, 4);
    expect(mid.y).toBeCloseTo(250, 4);
  });

  it("solves a genuine PERSPECTIVE (non-affine) mapping", () => {
    // A trapezoid image quad ↔ a rectangle floor quad → true perspective homography.
    const persp: CalibrationPair[] = [
      { image: { u: 100, v: 100 }, floor: { x: 0, y: 0 } },
      { image: { u: 540, v: 100 }, floor: { x: 4000, y: 0 } },
      { image: { u: 640, v: 480 }, floor: { x: 4000, y: 3000 } },
      { image: { u: 0, v: 480 }, floor: { x: 0, y: 3000 } },
    ];
    const H = solveHomography(persp);
    for (const p of persp) {
      const f = applyHomography(H, p.image);
      expect(f.x).toBeCloseTo(p.floor.x, 2);
      expect(f.y).toBeCloseTo(p.floor.y, 2);
    }
    expect(calibrationResidualMm(H, persp)).toBeLessThan(1e-3);
  });

  it("rejects <4 pairs and collinear/degenerate configurations", () => {
    expect(() => solveHomography(pairs.slice(0, 3))).toThrow(/≥4/);
    const collinear: CalibrationPair[] = [
      { image: { u: 0, v: 0 }, floor: { x: 0, y: 0 } },
      { image: { u: 1, v: 1 }, floor: { x: 1, y: 1 } },
      { image: { u: 2, v: 2 }, floor: { x: 2, y: 2 } },
      { image: { u: 3, v: 3 }, floor: { x: 3, y: 3 } },
    ];
    expect(() => solveHomography(collinear)).toThrow(/singular|degenerate|collinear/i);
  });

  it("isHomography guards shape", () => {
    expect(isHomography([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(true);
    expect(isHomography([1, 2, 3])).toBe(false);
    expect(isHomography("nope")).toBe(false);
  });

  it("applyHomography throws for a horizon (w≈0) pixel", () => {
    // H with last row (0,0,0) → w always 0 → point at infinity.
    const H: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 0];
    expect(() => applyHomography(H, { u: 5, v: 5 })).toThrow(/infinity|degenerate|horizon/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — producer geometry + backends
// ════════════════════════════════════════════════════════════════════════════
import {
  footPixel,
  detectionsToFloorHumans,
  InjectedDetectionBackend,
  NoDetectionBackend,
  OnnxPersonDetectionBackend,
  resolveHomography,
  type PersonDetection,
} from "./vision/humanDetectionProducer";

describe("producer geometry + backends (PURE)", () => {
  it("footPixel is the bottom-centre of the bbox", () => {
    const det: PersonDetection = { x: 100, y: 50, w: 40, h: 80, confidence: 0.9 };
    expect(footPixel(det)).toEqual({ u: 120, v: 130 });
  });

  it("detectionsToFloorHumans projects foot points through H (identity-ish scale)", () => {
    // H = ×10 scale + translate (matches the affine pairs above).
    const H = solveHomography([
      { image: { u: 0, v: 0 }, floor: { x: 100, y: 200 } },
      { image: { u: 10, v: 0 }, floor: { x: 200, y: 200 } },
      { image: { u: 0, v: 10 }, floor: { x: 100, y: 300 } },
      { image: { u: 10, v: 10 }, floor: { x: 200, y: 300 } },
    ]);
    const dets: PersonDetection[] = [{ x: 4, y: 0, w: 2, h: 10, confidence: 0.8, id: "p1" }]; // foot (5,10)
    const humans = detectionsToFloorHumans(dets, H);
    expect(humans).toHaveLength(1);
    expect(humans[0].id).toBe("p1");
    expect(humans[0].z).toBe(0);
    expect(humans[0].confidence).toBe(0.8);
    expect(humans[0].x).toBeCloseTo(150, 4); // u=5 → x 150
    expect(humans[0].y).toBeCloseTo(300, 4); // v=10 → y 300
  });

  it("NO-BACKEND produces NOTHING (honesty — never fabricates a person)", async () => {
    const b = new NoDetectionBackend();
    expect(await b.detect()).toEqual([]);
    expect(b.label()).toMatch(/no-backend/);
  });

  it("ONNX hook returns [] until a person model is exported+registered (honest seam)", async () => {
    const b = new OnnxPersonDetectionBackend();
    expect(await b.detect()).toEqual([]);
    expect(b.label()).toMatch(/SEAM/);
    expect(b.label()).toMatch(/yolo26n\.pt/);
  });

  it("INJECTED backend returns supplied detections verbatim", async () => {
    const dets: PersonDetection[] = [{ x: 0, y: 0, w: 1, h: 1, confidence: 1 }];
    const b = new InjectedDetectionBackend(dets);
    expect(await b.detect()).toEqual(dets);
  });

  it("resolveHomography solves from ≥4 pairs and rejects bad input", () => {
    const r = resolveHomography({ pairs: [
      { image: { u: 0, v: 0 }, floor: { x: 0, y: 0 } },
      { image: { u: 10, v: 0 }, floor: { x: 100, y: 0 } },
      { image: { u: 0, v: 10 }, floor: { x: 0, y: 100 } },
      { image: { u: 10, v: 10 }, floor: { x: 100, y: 100 } },
    ] });
    expect("H" in r).toBe(true);
    expect((resolveHomography({}) as any).error).toMatch(/homography|pairs/);
    expect((resolveHomography({ homography: [1, 2, 3] as any }) as any).error).toMatch(/9 finite/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PURE — safety-PLC status mapping + sim backend
// ════════════════════════════════════════════════════════════════════════════
import { statusToFindings, SimSafetyPlcBackend } from "./plc/safetyPlcAdapter";

describe("safety-PLC status mapping (PURE)", () => {
  it("maps each active flag → the right advisory event type", () => {
    const f = statusToFindings({ estop: true, zoneOccupied: true, resetRequired: true, muting: true });
    const byFlag = Object.fromEntries(f.map((x) => [x.flag, x.eventType]));
    expect(byFlag.estop).toBe("estop");
    expect(byFlag.zoneOccupied).toBe("zone_intrusion");
    expect(byFlag.resetRequired).toBe("intrusion");
    expect(byFlag.muting).toBe("speed_violation");
  });

  it("estop finding notes READ-ONLY / NOT actuated (honesty)", () => {
    const [f] = statusToFindings({ estop: true });
    expect(f.note).toMatch(/read-only|NOT actuated/i);
  });

  it("all-clear / false flags → no findings", () => {
    expect(statusToFindings({})).toHaveLength(0);
    expect(statusToFindings({ estop: false, muting: false })).toHaveLength(0);
  });

  it("sim backend cycles the script; empty script → all-clear (never invents a fault)", async () => {
    const empty = new SimSafetyPlcBackend([]);
    expect(await empty.read()).toEqual({});
    expect(empty.label()).toMatch(/NOT a live PLC/);
    const scripted = new SimSafetyPlcBackend([{ estop: true }, { zoneOccupied: true }]);
    expect(await scripted.read()).toEqual({ estop: true });
    expect(await scripted.read()).toEqual({ zoneOccupied: true });
    expect(await scripted.read()).toEqual({ estop: true }); // wraps
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SERVICE — in-memory fake db (mirrors safety.s2a.test.ts harness)
// ════════════════════════════════════════════════════════════════════════════
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  gte: (col: any, val: any) => ({ __op: "gte", __k: col?.name, __v: val }),
  desc: (col: any) => ({ __desc: col?.name }),
  sql: () => ({}),
}));

type Row = Record<string, any>;
const store: Record<string, Row[]> = { safety_events: [], safety_zones: [], camera_calibrations: [], safety_plc_configs: [] };
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

// Mock the OT driver registry for the safety-PLC REAL-endpoint read path.
const mockReadTags = vi.fn();
vi.mock("../ot/driverRegistry", () => ({
  createDriver: () => ({
    connect: async () => undefined,
    disconnect: async () => undefined,
    readTags: (...a: any[]) => mockReadTags(...a),
  }),
}));

import { produce, upsertCalibration, listCalibrations } from "./vision/humanDetectionProducer";
import { readAndRecord, upsertPlcConfig } from "./plc/safetyPlcAdapter";

// A ×10 + translate homography (foot pixel maps into the rated band near origin robot).
const H10: Homography = solveHomography([
  { image: { u: 0, v: 0 }, floor: { x: 0, y: 0 } },
  { image: { u: 10, v: 0 }, floor: { x: 100, y: 0 } },
  { image: { u: 0, v: 10 }, floor: { x: 0, y: 100 } },
  { image: { u: 10, v: 10 }, floor: { x: 100, y: 100 } },
]);

const svcZone = {
  id: 1,
  code: "Z1",
  name: "cell",
  robotId: 7,
  geometry: null,
  speedReduceDistanceMm: 2000,
  stopDistanceMm: 1000,
  ratedStopDistanceMm: 500,
  reactionSpeedPct: 30,
  enabled: true,
};

beforeEach(() => {
  reset();
  emitSafetyEvent.mockClear();
  mockReadTags.mockReset();
  delete process.env.SAFETY_VISION_ENABLED;
  delete process.env.SAFETY_PLC_ADAPTER_ENABLED;
  delete process.env.SAFETY_ZONE_SW_ENABLED;
  delete process.env.SAFETY_AUDIT_ENABLED;
  delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
  delete process.env.OT_CONTROL_ENABLED;
});

describe("vision producer (service)", () => {
  it("flag OFF → no-op (produces nothing)", async () => {
    const r = await produce({ calibration: { homography: H10, robotId: 7 } as any, detections: [{ x: 0, y: 0, w: 2, h: 4, confidence: 1 }] });
    expect(r.enabled).toBe(false);
    expect(r.floorHumans).toHaveLength(0);
    expect(r.evaluation).toBeNull();
  });

  it("upsertCalibration solves + persists H; produce → floor humans → S2a reactions + events", async () => {
    process.env.SAFETY_VISION_ENABLED = "true";
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    store.safety_zones.push({ ...svcZone });

    const up = await upsertCalibration({
      cameraId: "cam-1",
      robotId: 7,
      pairs: [
        { image: { u: 0, v: 0 }, floor: { x: 0, y: 0 } },
        { image: { u: 10, v: 0 }, floor: { x: 100, y: 0 } },
        { image: { u: 0, v: 10 }, floor: { x: 0, y: 100 } },
        { image: { u: 10, v: 10 }, floor: { x: 100, y: 100 } },
      ],
    });
    expect(up.ok).toBe(true);
    expect(up.residualMm).toBeLessThan(1e-6);
    expect(isHomography(up.calibration!.homography)).toBe(true);

    // A person whose foot pixel maps to floor (10,0) = 10mm from the robot at origin
    // → inside the rated band → advisory rated_stop LOGGED (never actuated).
    const r = await produce({
      cameraId: "cam-1",
      detections: [{ x: 0, y: -4, w: 2, h: 4, confidence: 0.95, id: "p1" }], // foot (1,0)→(10,0)
      robots: [{ id: 7, x: 0, y: 0, z: 0 }],
    });
    expect(r.enabled).toBe(true);
    expect(r.floorHumans).toHaveLength(1);
    expect(r.floorHumans[0].x).toBeCloseTo(10, 4);
    expect(r.evaluation!.reactions[0].level).toBe("rated_stop");
    expect(r.evaluation!.reactions[0].ratedStopLoggedNotActuated).toBe(true);
    expect(store.safety_events[0].detectedBy).toBe("vision");
  });

  it("no calibration for the camera → produces nothing (honest message)", async () => {
    process.env.SAFETY_VISION_ENABLED = "true";
    const r = await produce({ cameraId: "ghost", detections: [{ x: 0, y: 0, w: 2, h: 4, confidence: 1 }] });
    expect(r.floorHumans).toHaveLength(0);
    expect(r.message).toMatch(/no enabled calibration/);
  });

  it("empty detections (no-backend) → produces nothing even with a calibration", async () => {
    process.env.SAFETY_VISION_ENABLED = "true";
    await upsertCalibration({ cameraId: "cam-2", homography: H10, robotId: 7 });
    const r = await produce({ cameraId: "cam-2", detections: [] });
    expect(r.detectionCount).toBe(0);
    expect(r.floorHumans).toHaveLength(0);
    expect(r.evaluation).toBeNull();
  });
});

describe("safety-PLC adapter (service)", () => {
  it("flag OFF → no-op", async () => {
    const r = await readAndRecord({ id: 1, code: "PLC1", backend: "sim" } as any);
    expect(r.enabled).toBe(false);
    expect(r.recorded).toBe(0);
  });

  it("sim backend → scripted status emits advisory events (read-only)", async () => {
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    const up = await upsertPlcConfig({
      code: "PLC1",
      name: "Pilz cell",
      vendor: "pilz",
      backend: "sim",
      robotId: 7,
      statusMap: { simScript: [{ estop: true, zoneOccupied: true }] },
    });
    expect(up.ok).toBe(true);
    const r = await readAndRecord(up.config!);
    expect(r.enabled).toBe(true);
    expect(r.backend).toMatch(/sim/);
    expect(r.findings.map((f) => f.eventType).sort()).toEqual(["estop", "zone_intrusion"]);
    expect(r.recorded).toBe(2);
    // detectedBy telemetry (we READ status); notes carry the true 'sim' source.
    expect(store.safety_events.every((e) => e.detectedBy === "telemetry")).toBe(true);
    expect(store.safety_events.some((e) => /source sim/.test(e.notes))).toBe(true);
  });

  it("real modbus endpoint → reads via MOCKED OT driver → advisory events, never writes", async () => {
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    mockReadTags.mockResolvedValue([
      { tagKey: "estop", value: true, quality: "good", raw: 1, timestamp: new Date() },
      { tagKey: "muting", value: false, quality: "good", raw: 0, timestamp: new Date() },
    ]);
    const up = await upsertPlcConfig({
      code: "PLC2",
      name: "Sick Flexi",
      vendor: "sick",
      backend: "modbus",
      endpoint: "tcp://10.0.0.5:502",
      statusMap: { estop: { address: "10001", dataType: "bool" }, muting: { address: "10002", dataType: "bool" } },
    });
    const r = await readAndRecord(up.config!);
    expect(mockReadTags).toHaveBeenCalledTimes(1);
    expect(r.backend).toMatch(/real modbus/);
    expect(r.status.estop).toBe(true);
    expect(r.findings).toHaveLength(1); // only estop active
    expect(r.findings[0].eventType).toBe("estop");
    expect(store.safety_events[0].notes).toMatch(/source plc/);
  });

  it("real read failure → honest message, fabricates nothing", async () => {
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    mockReadTags.mockRejectedValue(new Error("connection refused"));
    const up = await upsertPlcConfig({
      code: "PLC3",
      name: "unreachable",
      backend: "modbus",
      endpoint: "tcp://10.0.0.9:502",
      statusMap: { estop: { address: "10001" } },
    });
    const r = await readAndRecord(up.config!);
    expect(r.findings).toHaveLength(0);
    expect(r.recorded).toBe(0);
    expect(r.message).toMatch(/read failed/);
  });
});
