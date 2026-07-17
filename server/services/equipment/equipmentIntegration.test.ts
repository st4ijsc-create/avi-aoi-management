/**
 * I1 (doc 16 Khối 1B / §6 / §15) — Equipment Integration tests.
 *
 * PURE / in-memory (no DB) — mirrors the secsgem/fleet/standards pattern:
 *   • FOCAS / Euromap framework: register as adapter kinds + honest read-only status
 *     + UEM mapping (recipe_id, cycle_count, alarm_code, utilization, production_counter)
 *     + local last-value cache (survives "connection drop").
 *   • Alarm normalization: maps a known vendor code, passes through an unknown code,
 *     and is a complete NO-OP when EQ_INTEG_ENABLED is off (existing Andon unchanged).
 *   • Recipe status vocabulary mapping (released <-> active) + flag-off no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { equipmentRegistry, ADAPTER_KINDS } from "./equipmentAdapter";
import {
  FocasAdapter,
  mapFocasToUem,
  focasAlarmCode,
  utilizationFromRunStatus,
  isEqIntegEnabled,
  FOCAS_VENDOR,
} from "../focas/focasAdapter";
import {
  EuromapAdapter,
  mapEuromapToUem,
  utilizationFromMode,
} from "../euromap/euromapAdapter";
import {
  severityToAndonState,
  standardCodeToReason,
  buildAndonInput,
} from "./alarmNormalizer";
import { toDesignStatus, toDbStatus } from "./recipeVersioningService";

// ── adapter registry: FOCAS/Euromap are registered, read-only kinds ───────────
describe("I1-a — FOCAS/Euromap registered as adapter kinds", () => {
  afterEach(() => equipmentRegistry._clear());

  it("registers focas + euromap kinds delegating to their own framework", () => {
    expect(ADAPTER_KINDS).toContain("focas");
    expect(ADAPTER_KINDS).toContain("euromap");
    const focas = equipmentRegistry.getAdapter("focas");
    expect(focas.kind).toBe("focas");
    expect(focas.delegatesTo).toBe("focas");
    const euromap = equipmentRegistry.getAdapter("euromap");
    expect(euromap.delegatesTo).toBe("euromap");
  });

  it("rejects commands (telemetry-only, no control path)", async () => {
    const focas = equipmentRegistry.getAdapter("focas");
    const res = await focas.sendCommand({
      name: "start",
      idempotencyKey: "k1",
      hitl: { actionId: "a1", requestedBy: 1 },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe("rejected");
  });
});

// ── FOCAS framework: honest read-only + UEM mapping + cache ───────────────────
describe("I1-a — FOCAS framework (honest, read-only)", () => {
  it("reports an honest read-only status with a caveat (no native lib, no device)", () => {
    const a = new FocasAdapter("CNC-07");
    const t = a.testConnection();
    expect(t.ok).toBe(false);
    expect(t.readOnly).toBe(true);
    expect(t.vendor).toBe(FOCAS_VENDOR);
    expect(t.caveat).toMatch(/no real|framework|no native/i);
  });

  it("returns source:'none' and null UEM before any readout (no fabricated data)", () => {
    const snap = new FocasAdapter("CNC-07").readSnapshot();
    expect(snap.source).toBe("none");
    expect(snap.connected).toBe(false);
    expect(snap.recipeId).toBeNull();
    expect(snap.cycleCount).toBeNull();
    expect(snap.alarmCode).toBeNull();
  });

  it("maps native FOCAS fields into the Unified Equipment Model", () => {
    const uem = mapFocasToUem({
      programName: "O1234",
      cycleCount: 42,
      partCountTotal: 1000,
      runStatus: "START",
      alarms: [{ almNo: 50, type: "SV" }],
    });
    expect(uem.recipeId).toBe("O1234");
    expect(uem.cycleCount).toBe(42);
    expect(uem.productionCounter).toBe(1000);
    expect(uem.utilizationRate).toBe(1);
    expect(uem.alarmCode).toBe("SV50");
  });

  it("the local cache serves the last-known value after a 'connection drop'", () => {
    const a = new FocasAdapter("CNC-07");
    a.ingest({ programNumber: 9, cycleCount: 7, runStatus: "START" });
    // simulate the connection being gone — readSnapshot still has the cached value.
    const snap = a.readSnapshot();
    expect(snap.source).toBe("cache");
    expect(snap.recipeId).toBe("9");
    expect(snap.cycleCount).toBe(7);
    expect(snap.connected).toBe(false); // honest: still no live link
  });

  it("focasAlarmCode + utilization heuristics", () => {
    expect(focasAlarmCode({ almNo: 100, type: "ps" })).toBe("PS100");
    expect(utilizationFromRunStatus("START")).toBe(1);
    expect(utilizationFromRunStatus("HOLD")).toBe(0.5);
    expect(utilizationFromRunStatus("STOP")).toBe(0);
    expect(utilizationFromRunStatus(undefined)).toBeNull();
  });
});

// ── Euromap framework: honest read-only + UEM mapping ─────────────────────────
describe("I1-a — Euromap framework (honest, read-only)", () => {
  it("honest status + no fabricated data", () => {
    const a = new EuromapAdapter("IMM-01");
    expect(a.testConnection().ok).toBe(false);
    const snap = a.readSnapshot();
    expect(snap.source).toBe("none");
    expect(snap.productionCounter).toBeNull();
  });

  it("maps native Euromap fields into the UEM", () => {
    const uem = mapEuromapToUem({
      transport: "euromap77",
      activeMoldId: "MOLD-5",
      shotCounter: 5000,
      goodPartsCounter: 4900,
      machineMode: "AUTOMATIC",
      targetCycleTimeSec: 20,
      actualCycleTimeSec: 25,
      alarms: [{ code: "E63-12", active: true }],
    });
    expect(uem.recipeId).toBe("MOLD-5");
    expect(uem.cycleCount).toBe(5000);
    expect(uem.productionCounter).toBe(4900);
    expect(uem.utilizationRate).toBeCloseTo(0.8, 5);
    expect(uem.alarmCode).toBe("E63-12");
  });

  it("utilizationFromMode heuristic", () => {
    expect(utilizationFromMode({ machineMode: "AUTOMATIC" })).toBe(1);
    expect(utilizationFromMode({ machineMode: "MANUAL" })).toBe(0);
    expect(utilizationFromMode({})).toBeNull();
  });

  it("cache survives a connection drop", () => {
    const a = new EuromapAdapter("IMM-01");
    a.ingest({ transport: "euromap83", shotCounter: 12, machineMode: "AUTOMATIC" });
    const snap = a.readSnapshot();
    expect(snap.source).toBe("cache");
    expect(snap.cycleCount).toBe(12);
    expect(snap.transport).toBe("euromap83");
  });
});

// ── Alarm normalization (I1-c) — maps known, passes through unknown, flag-off no-op
describe("I1-c — alarm normalization", () => {
  const KNOWN = { vendor: "fanuc", nativeCode: "SRVO-050" }; // seeded → COLLISION/critical (doc 37 vendor dataset)
  const UNKNOWN = { vendor: "acme", nativeCode: "ZZZ-999" };

  beforeEach(() => { delete process.env.EQ_INTEG_ENABLED; });
  afterEach(() => { vi.resetModules(); delete process.env.EQ_INTEG_ENABLED; });

  it("severity → andon state + standard code → reason mapping", () => {
    expect(severityToAndonState("critical")).toBe("red");
    expect(severityToAndonState("low")).toBe("yellow");
    expect(standardCodeToReason("COLLISION_DETECT")).toBe("safety");
    expect(standardCodeToReason("OVERTEMP")).toBe("maintenance");
  });

  it("builds a normalized Andon input for a KNOWN code", async () => {
    const { mapAlarm } = await import("../standards/alarmTaxonomy");
    const normalized = mapAlarm(KNOWN.vendor, KNOWN.nativeCode);
    expect(normalized.mapped).toBe(true);
    expect(normalized.standardCode).toBe("COLLISION");
    const input = buildAndonInput({ ...KNOWN, machineId: 5 }, normalized);
    expect(input.state).toBe("red");
    expect(input.reason).toBe("safety");
    expect(input.raisedBySystem).toBe(true);
    expect(input.title).toContain("COLLISION");
  });

  it("passes through an UNKNOWN code as the fail-safe default (still raises a yellow advisory)", async () => {
    const { mapAlarm } = await import("../standards/alarmTaxonomy");
    const normalized = mapAlarm(UNKNOWN.vendor, UNKNOWN.nativeCode);
    expect(normalized.mapped).toBe(false);
    expect(normalized.standardCode).toBe("UNKNOWN_ALARM");
    const input = buildAndonInput(UNKNOWN, normalized);
    expect(input.state).toBe("yellow"); // medium default
    expect(input.title).toContain("unmapped");
  });

  it("FLAG OFF → normalizeAndRaise is a NO-OP (raises nothing, returns the mapping)", async () => {
    // andonService must NOT be touched when the flag is off.
    const raiseAndon = vi.fn(async () => ({ id: 1 }));
    vi.doMock("../andon/andonService", () => ({ raiseAndon }));
    const { normalizeAndRaise } = await import("./alarmNormalizer");
    const res = await normalizeAndRaise({ ...KNOWN, machineId: 5 });
    expect(res.raised).toBe(false);
    expect(res.andon).toBeNull();
    expect(res.normalized.standardCode).toBe("COLLISION");
    expect(raiseAndon).not.toHaveBeenCalled();
  });

  it("FLAG ON → normalizeAndRaise raises a normalized Andon via andonService", async () => {
    process.env.EQ_INTEG_ENABLED = "true";
    const raiseAndon = vi.fn(async (input: any) => ({ id: 7, ...input }));
    vi.doMock("../andon/andonService", () => ({ raiseAndon }));
    const { normalizeAndRaise } = await import("./alarmNormalizer");
    const res = await normalizeAndRaise({ ...KNOWN, machineId: 5 });
    expect(res.raised).toBe(true);
    expect(raiseAndon).toHaveBeenCalledOnce();
    const passed = raiseAndon.mock.calls[0][0] as any;
    expect(passed.state).toBe("red");
    expect(passed.title).toContain("COLLISION"); // standard code, not raw
  });
});

// ── Recipe status vocabulary + flag helper ────────────────────────────────────
describe("I1-b — recipe status vocabulary mapping", () => {
  afterEach(() => { delete process.env.EQ_INTEG_ENABLED; });

  it("maps released <-> active and leaves draft/archived unchanged", () => {
    expect(toDesignStatus("active")).toBe("released");
    expect(toDesignStatus("draft")).toBe("draft");
    expect(toDesignStatus("archived")).toBe("archived");
    expect(toDbStatus("released")).toBe("active");
    expect(toDbStatus("draft")).toBe("draft");
    expect(toDbStatus("archived")).toBe("archived");
  });

  it("isEqIntegEnabled reads the flag", () => {
    delete process.env.EQ_INTEG_ENABLED;
    expect(isEqIntegEnabled()).toBe(false);
    process.env.EQ_INTEG_ENABLED = "true";
    expect(isEqIntegEnabled()).toBe(true);
  });
});
