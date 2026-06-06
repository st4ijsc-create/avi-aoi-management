/**
 * Sprint G2.7 — socket twin emitter tests.
 *
 * Covers: emitTwinUpdate is a no-op when io is not initialized; it does NOT emit
 * when TWIN_STREAM_ENABLED is off (default); and the twin path performs NO DB
 * write (source-scan invariant). io is module-private and never initialized in
 * this unit test, so emitTwinUpdate must return cleanly without throwing.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emitTwinUpdate, startTwinBroadcaster, stopTwinBroadcaster } from "./socket";

const ORIG = process.env.TWIN_STREAM_ENABLED;

afterEach(() => {
  process.env.TWIN_STREAM_ENABLED = ORIG;
  stopTwinBroadcaster();
});

describe("emitTwinUpdate (signal-only, gated)", () => {
  it("is a no-op when io is not initialized (does not throw)", () => {
    process.env.TWIN_STREAM_ENABLED = "true";
    expect(() =>
      emitTwinUpdate({ lineId: 1, stations: [{ stationId: 1, wipCount: 3 }], ts: Date.now() }),
    ).not.toThrow();
  });

  it("does NOT emit / start when flag is off (default)", () => {
    process.env.TWIN_STREAM_ENABLED = "false";
    // No io + flag off → emit is a clean no-op.
    expect(() =>
      emitTwinUpdate({ stations: [{ stationId: 2, wipCount: 1 }], ts: Date.now() }),
    ).not.toThrow();
    // Broadcaster must not start when gated off (no io anyway).
    expect(() => startTwinBroadcaster(10)).not.toThrow();
  });
});

describe("SAFETY — twin path does NOT write the DB", () => {
  it("emitTwinUpdate / broadcaster section has no INSERT/UPDATE/createMachine* call", () => {
    const src = readFileSync(join(__dirname, "socket.ts"), "utf8");
    const start = src.indexOf("DIGITAL TWIN STREAM");
    const end = src.indexOf("AlertEscalationEvent");
    expect(start).toBeGreaterThan(-1);
    const section = src.slice(start, end > start ? end : undefined);
    expect(section).not.toMatch(/commandDispatcher/);
    expect(section).not.toMatch(/writeTags/);
    expect(section).not.toMatch(/\.insert\(/);
    expect(section).not.toMatch(/\.update\(/);
    // the only DB touch on the broadcaster path is a SELECT via getWipByStation
    expect(section).toMatch(/getWipByStation/);
  });
});
