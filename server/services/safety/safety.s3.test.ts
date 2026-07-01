/**
 * doc 22 · P2 (Khối 3) — Safety closed-loop demonstrability tests.
 *
 * Covers, in the pure/mocked style of safety.s2a/s2b:
 *   • simTrackPublisher (PURE): flag gate, deterministic triangle-wave distance that
 *     sweeps ALL bands, synthetic detection is always source 'test' (SIMULATED).
 *   • simTrackPublisher (SERVICE): runSimTick drives the EXISTING advisory path →
 *     zone reactions + advisory safety_events; flag-off is a complete no-op.
 *   • responseTimeMs is populated on zone-reaction records + persisted (ISO/TS 15066).
 *   • detectedBy carries HONEST 'sim' provenance for simulated tracks (not 'operator').
 *
 * ⚠ Everything here is ADVISORY. No device is commanded; rated_stop stays LOG-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ════════════════════════════════════════════════════════════════════════════
// PURE — sim distance sweep + synthetic detection (no mocks needed)
// ════════════════════════════════════════════════════════════════════════════
import {
  simDistanceMm,
  buildSimDetection,
  safetySimTracksEnabled,
  simTracksIntervalMs,
} from "./simTrackPublisher";

describe("simTrackPublisher — flag + config (PURE)", () => {
  beforeEach(() => {
    delete process.env.SAFETY_SIM_TRACKS_ENABLED;
    delete process.env.SAFETY_SIM_TRACKS_INTERVAL_MS;
  });

  it("flag defaults OFF; accepts 'true'/'1'", () => {
    expect(safetySimTracksEnabled()).toBe(false);
    process.env.SAFETY_SIM_TRACKS_ENABLED = "true";
    expect(safetySimTracksEnabled()).toBe(true);
    process.env.SAFETY_SIM_TRACKS_ENABLED = "1";
    expect(safetySimTracksEnabled()).toBe(true);
    process.env.SAFETY_SIM_TRACKS_ENABLED = "no";
    expect(safetySimTracksEnabled()).toBe(false);
  });

  it("interval defaults 5s and is clamped to [1s, 5min]", () => {
    expect(simTracksIntervalMs()).toBe(5000);
    process.env.SAFETY_SIM_TRACKS_INTERVAL_MS = "10";
    expect(simTracksIntervalMs()).toBe(1000); // clamped up
    process.env.SAFETY_SIM_TRACKS_INTERVAL_MS = "9999999";
    expect(simTracksIntervalMs()).toBe(5 * 60 * 1000); // clamped down
    process.env.SAFETY_SIM_TRACKS_INTERVAL_MS = "2500";
    expect(simTracksIntervalMs()).toBe(2500);
  });
});

describe("simDistanceMm (PURE) — deterministic sweep across all bands", () => {
  it("is a bounded triangle wave in [200, 2600]", () => {
    const vals = Array.from({ length: 8 }, (_, t) => simDistanceMm(t));
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(200);
      expect(v).toBeLessThanOrEqual(2600);
    }
    // over a full period it visits at least the extremes.
    expect(Math.min(...vals)).toBe(200);
    expect(Math.max(...vals)).toBe(2600);
  });

  it("crosses every reaction band over a cycle (none / speed_reduce / stop / rated_stop)", () => {
    // default thresholds 2000/1000/500 → band boundaries.
    const dists = Array.from({ length: 8 }, (_, t) => simDistanceMm(t));
    const band = (d: number) => (d < 500 ? "rated_stop" : d < 1000 ? "stop" : d < 2000 ? "speed_reduce" : "none");
    const bands = new Set(dists.map(band));
    expect(bands.has("none")).toBe(true);
    expect(bands.has("speed_reduce")).toBe(true);
    expect(bands.has("stop")).toBe(true);
    expect(bands.has("rated_stop")).toBe(true);
  });

  it("is deterministic + periodic (tick t == tick t+period)", () => {
    for (let t = 0; t < 8; t++) expect(simDistanceMm(t)).toBe(simDistanceMm(t + 8));
  });
});

describe("buildSimDetection (PURE) — always SIMULATED (source 'test')", () => {
  it("never fabricates a real-sensor provenance", () => {
    const det = buildSimDetection(2);
    expect(det.source).toBe("test");
    expect(det.confidence).toBeGreaterThan(0);
    expect(det.robotId).toBeGreaterThan(0);
    expect(det.distance).toBe(simDistanceMm(2));
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
// raiseAndon is on the S1 near-miss path — stub it so the sim tick doesn't need andon.
const raiseAndon = vi.fn(async () => ({ id: 999 }));
vi.mock("../andon/andonService", () => ({ raiseAndon: (...a: any[]) => raiseAndon(...a) }));

import { runSimTick, startSimTrackPublisher, stopSimTrackPublisher } from "./simTrackPublisher";
import { evaluateAndRecord } from "./safetyZoneService";

const svcZone = {
  id: 1,
  code: "Z1",
  name: "cell",
  robotId: 1, // matches the default sim robot id
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
  raiseAndon.mockClear();
  delete process.env.SAFETY_SIM_TRACKS_ENABLED;
  delete process.env.SAFETY_SIM_TRACKS_INTERVAL_MS;
  delete process.env.SAFETY_ZONE_SW_ENABLED;
  delete process.env.SAFETY_AUDIT_ENABLED;
  delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
  delete process.env.OT_CONTROL_ENABLED;
});

describe("simTrackPublisher.runSimTick (service) — drives the advisory loop", () => {
  it("flag-gated services OFF → complete no-op (no events, no emit)", async () => {
    // SAFETY_ZONE_SW / SAFETY_AUDIT both off.
    const r = await runSimTick(0); // tick 0 → distance 200mm (rated band if it ran)
    expect(r.near.enabled).toBe(false);
    expect(r.zone).toBeNull(); // evaluateFromProximity returns null when zone flag off
    expect(store.safety_events).toHaveLength(0);
    expect(emitSafetyEvent).not.toHaveBeenCalled();
  });

  it("zone+audit ON → a rated-band sim tick LOGS an advisory event (never actuates) + emits", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true"; // prove: still never actuates
    process.env.OT_CONTROL_ENABLED = "true";
    store.safety_zones.push({ ...svcZone });

    const r = await runSimTick(0); // distance 200mm → rated_stop
    expect(r.zone!.enabled).toBe(true);
    const rc = r.zone!.reactions[0];
    expect(rc.level).toBe("rated_stop");
    expect(rc.ratedStopLoggedNotActuated).toBe(true);
    expect(rc.proposal).toBeNull(); // rated_stop: no command proposal
    // The zone evaluator persisted a rated_stop finding (logged_only) with honest 'sim'
    // provenance. (The S1 near-miss path ALSO records a near_miss for the same tick — the
    // loop is demonstrable end-to-end: evaluator → advisory event → socket emit.)
    const zoneEvent = store.safety_events.find((e) => e.eventType === "zone_intrusion");
    expect(zoneEvent).toBeTruthy();
    expect(zoneEvent!.outcome).toBe("logged_only"); // did NOT actuate the rated stop
    expect(zoneEvent!.detectedBy).toBe("sim"); // HONEST provenance
    expect(emitSafetyEvent).toHaveBeenCalled(); // socket fired (cockpit sees it)
  });

  it("sim events are labelled SIMULATED (source in notes + humanPosition)", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    store.safety_zones.push({ ...svcZone });
    await runSimTick(0);
    const ev = store.safety_events.find((e) => e.eventType === "zone_intrusion")!;
    expect(ev.notes).toMatch(/source sim/);
    expect(ev.humanPosition?.source).toBe("sim");
  });
});

describe("start/stopSimTrackPublisher — no-op-safe when flag OFF", () => {
  it("start() with flag OFF schedules nothing; stop() is safe", () => {
    const setSpy = vi.spyOn(global, "setInterval");
    startSimTrackPublisher(); // flag off
    expect(setSpy).not.toHaveBeenCalled();
    stopSimTrackPublisher(); // safe no-op
    setSpy.mockRestore();
  });

  it("start() with flag ON schedules an unref'd interval; stop() clears it", () => {
    process.env.SAFETY_SIM_TRACKS_ENABLED = "true";
    const setSpy = vi.spyOn(global, "setInterval");
    const clearSpy = vi.spyOn(global, "clearInterval");
    startSimTrackPublisher();
    expect(setSpy).toHaveBeenCalledTimes(1);
    // idempotent: a second start does not schedule again.
    startSimTrackPublisher();
    expect(setSpy).toHaveBeenCalledTimes(1);
    stopSimTrackPublisher();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// responseTimeMs + detectedBy — populated on zone-reaction records (ISO/TS 15066)
// ════════════════════════════════════════════════════════════════════════════
describe("evaluateAndRecord — responseTimeMs + honest detectedBy", () => {
  it("populates responseTimeMs (≥0) from detectedAtMs and persists it", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    const detectedAtMs = Date.now() - 42; // 42ms ago
    const r = await evaluateAndRecord({
      humans: [{ id: "a", x: 300, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [{ ...svcZone, robotId: null }],
      detectedAtMs,
    });
    const rc = r.reactions[0];
    expect(rc.level).toBe("rated_stop");
    expect(rc.responseTimeMs).toBeGreaterThanOrEqual(42);
    expect(store.safety_events[0].responseTimeMs).toBe(rc.responseTimeMs);
  });

  it("responseTimeMs is clamped ≥0 even if detectedAtMs is in the future (clock skew)", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    const r = await evaluateAndRecord({
      humans: [{ id: "a", x: 300, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [{ ...svcZone, robotId: null }],
      detectedAtMs: Date.now() + 10_000, // future
    });
    expect(r.reactions[0].responseTimeMs).toBe(0);
  });

  it("detectedBy is 'sim' for simulated tracks, 'vision' for the vision source", async () => {
    process.env.SAFETY_ZONE_SW_ENABLED = "true";
    process.env.SAFETY_AUDIT_ENABLED = "true";
    await evaluateAndRecord({
      humans: [{ id: "a", x: 300, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [{ ...svcZone, robotId: null }],
      source: "sim",
    });
    expect(store.safety_events[0].detectedBy).toBe("sim");
    reset();
    await evaluateAndRecord({
      humans: [{ id: "a", x: 300, y: 0, confidence: 1 }],
      robots: [{ id: 7, x: 0, y: 0 }],
      zones: [{ ...svcZone, robotId: null }],
      source: "vision",
    });
    expect(store.safety_events[0].detectedBy).toBe("vision");
  });
});
