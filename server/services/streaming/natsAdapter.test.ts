/**
 * doc 44 W4 / G2.7 — NATS adapter tests (nats client installed + WIRED).
 *   • lib present → natsClientAvailable() true
 *   • no NATS_URL / unreachable server → available() false + ops refuse with
 *     NATS_NOT_AVAILABLE (never fake cross-process durability)
 *   • topic → subject mapping is correct for the real wiring
 * (Live JetStream publish/replay round-trip is covered by an ops smoke, not a
 *  hermetic unit test — this suite must not depend on a running broker.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createNatsStreamBridge,
  topicToSubject,
  natsClientAvailable,
  __resetNatsSeamLog,
} from "./natsAdapter";
import { StreamNotAvailableError } from "./streamBridge";

describe("natsAdapter — lib present, honest refuse without a reachable broker", () => {
  beforeEach(() => {
    __resetNatsSeamLog();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NATS_URL;
  });

  it("natsClientAvailable() is true (nats package installed)", async () => {
    expect(await natsClientAvailable()).toBe(true);
  });

  it("available() is false without NATS_URL", async () => {
    const b = createNatsStreamBridge();
    expect(await b.available()).toBe(false);
  });

  it("available() is false with an unreachable NATS_URL (connect fails honestly)", async () => {
    // Port 1 is unusable → connect rejects → ensure() returns null → not available.
    process.env.NATS_URL = "nats://127.0.0.1:1";
    const b = createNatsStreamBridge();
    expect(await b.available()).toBe(false);
  });

  it("publish refuses with NATS_NOT_AVAILABLE (no fake ack)", async () => {
    const b = createNatsStreamBridge();
    const r = await b.publish("syn/telemetry/l1", { v: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NATS_NOT_AVAILABLE");
  });

  it("replay throws StreamNotAvailableError(NATS_NOT_AVAILABLE)", async () => {
    const b = createNatsStreamBridge();
    await expect(b.replay("syn/telemetry/l1", 1, () => {})).rejects.toMatchObject({
      code: "NATS_NOT_AVAILABLE",
    });
    await expect(b.replay("syn/telemetry/l1", 1, () => {})).rejects.toBeInstanceOf(StreamNotAvailableError);
  });

  it("subscribe returns an inert subscription (no live consumer)", () => {
    const b = createNatsStreamBridge();
    const sub = b.subscribe("syn/telemetry/l1", () => {});
    expect(sub.topic).toBe("syn/telemetry/l1");
    expect(() => sub.unsubscribe()).not.toThrow();
  });

  it("backend metadata claims cross-process durability (the reason to switch)", () => {
    const b = createNatsStreamBridge();
    expect(b.backend).toBe("nats");
    expect(b.crossProcessDurable).toBe(true);
  });
});

describe("topicToSubject", () => {
  it('maps "/" → "." for NATS subjects', () => {
    expect(topicToSubject("syn/telemetry/l1")).toBe("syn.telemetry.l1");
  });
  it('maps trailing "/*" → ".>" (NATS multi-level wildcard)', () => {
    expect(topicToSubject("syn/telemetry/*")).toBe("syn.telemetry.>");
  });
});
