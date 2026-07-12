/**
 * doc 44 W4 / G2.7 — StreamBridge (in-process adapter) tests.
 *   • topicMatches: exact / "*" / trailing "/*"
 *   • publish assigns per-topic monotonic seq; live subscribers receive matches
 *   • replay(fromSeq) redelivers retained messages; bounded ring evicts + flags truncation
 *   • getStreamBridge factory honours STREAM_BRIDGE_BACKEND (default inprocess)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInProcessStreamBridge } from "./inProcessAdapter";
import {
  topicMatches,
  getStreamBridge,
  resetStreamBridge,
  streamBackend,
  type StreamMessage,
} from "./streamBridge";

describe("topicMatches", () => {
  it("exact match", () => {
    expect(topicMatches("syn/telemetry", "syn/telemetry")).toBe(true);
    expect(topicMatches("syn/telemetry", "syn/state")).toBe(false);
  });
  it('"*" matches everything', () => {
    expect(topicMatches("*", "anything/at/all")).toBe(true);
  });
  it('trailing "/*" matches the subtree', () => {
    expect(topicMatches("syn/telemetry/*", "syn/telemetry/l1")).toBe(true);
    expect(topicMatches("syn/telemetry/*", "syn/telemetry/l1/dev0")).toBe(true);
    expect(topicMatches("syn/telemetry/*", "syn/state/l1")).toBe(false);
  });
});

describe("inProcessAdapter", () => {
  let bridge: ReturnType<typeof createInProcessStreamBridge>;

  beforeEach(() => {
    bridge = createInProcessStreamBridge();
  });
  afterEach(async () => {
    await bridge.close();
  });

  it("publish assigns a monotonic per-topic seq", async () => {
    const r1 = await bridge.publish("t/a", { n: 1 });
    const r2 = await bridge.publish("t/a", { n: 2 });
    const r3 = await bridge.publish("t/b", { n: 1 });
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
    expect(r3.seq).toBe(1); // separate topic → its own sequence
  });

  it("live subscribers receive matching messages (exact + wildcard)", async () => {
    const exact: StreamMessage[] = [];
    const wild: StreamMessage[] = [];
    bridge.subscribe("syn/telemetry/l1", (m) => void exact.push(m));
    bridge.subscribe("syn/telemetry/*", (m) => void wild.push(m));

    await bridge.publish("syn/telemetry/l1", { v: 1 });
    await bridge.publish("syn/telemetry/l2", { v: 2 });

    expect(exact.map((m) => m.payload)).toEqual([{ v: 1 }]);
    expect(wild.map((m) => m.payload)).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it("unsubscribe stops delivery", async () => {
    const seen: unknown[] = [];
    const sub = bridge.subscribe("t/x", (m) => void seen.push(m.payload));
    await bridge.publish("t/x", 1);
    sub.unsubscribe();
    await bridge.publish("t/x", 2);
    expect(seen).toEqual([1]);
  });

  it("replay(fromSeq) redelivers retained messages in seq order", async () => {
    await bridge.publish("t/r", "a");
    await bridge.publish("t/r", "b");
    await bridge.publish("t/r", "c");
    const got: Array<{ seq: number; payload: unknown }> = [];
    const res = await bridge.replay("t/r", 2, (m) => void got.push({ seq: m.seq, payload: m.payload }));
    expect(res.ok).toBe(true);
    expect(res.delivered).toBe(2);
    expect(res.fromSeq).toBe(2);
    expect(res.toSeq).toBe(3);
    expect(got).toEqual([
      { seq: 2, payload: "b" },
      { seq: 3, payload: "c" },
    ]);
    expect(res.truncated).toBeUndefined();
  });

  it("subscribe with fromSeq replays retained then delivers live", async () => {
    await bridge.publish("t/s", "old1");
    await bridge.publish("t/s", "old2");
    const got: unknown[] = [];
    bridge.subscribe("t/s", (m) => void got.push(m.payload), { fromSeq: 1 });
    // allow the async replay-on-subscribe to run
    await Promise.resolve();
    await bridge.publish("t/s", "live");
    // replay may resolve after the live publish; assert set membership
    await new Promise((r) => setTimeout(r, 5));
    expect(got).toContain("old1");
    expect(got).toContain("old2");
    expect(got).toContain("live");
  });

  it("bounded ring evicts oldest + flags replay truncation", async () => {
    process.env.STREAM_RING_MAX = "100";
    const b = createInProcessStreamBridge();
    try {
      for (let i = 0; i < 150; i++) await b.publish("t/big", i);
      const got: number[] = [];
      const res = await b.replay("t/big", 1, (m) => void got.push(m.payload as number));
      expect(res.truncated).toBe(true); // seq 1..50 were evicted
      expect(res.delivered).toBeLessThanOrEqual(100);
      expect(res.delivered).toBeGreaterThan(0);
      expect(res.toSeq).toBe(150); // newest retained
    } finally {
      await b.close();
      delete process.env.STREAM_RING_MAX;
    }
  });

  it("publish after close is refused honestly", async () => {
    const b = createInProcessStreamBridge();
    await b.close();
    const r = await b.publish("t/c", 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BRIDGE_CLOSED");
  });
});

describe("getStreamBridge factory", () => {
  beforeEach(async () => {
    await resetStreamBridge();
    delete process.env.STREAM_BRIDGE_BACKEND;
  });
  afterEach(async () => {
    await resetStreamBridge();
    delete process.env.STREAM_BRIDGE_BACKEND;
  });

  it("defaults to the in-process backend", async () => {
    expect(streamBackend()).toBe("inprocess");
    const b = await getStreamBridge();
    expect(b.backend).toBe("inprocess");
    expect(b.crossProcessDurable).toBe(false);
  });

  it("selects the nats backend when STREAM_BRIDGE_BACKEND=nats", async () => {
    process.env.STREAM_BRIDGE_BACKEND = "nats";
    expect(streamBackend()).toBe("nats");
    const b = await getStreamBridge();
    expect(b.backend).toBe("nats");
    expect(b.crossProcessDurable).toBe(true);
  });

  it("returns the same singleton until reset", async () => {
    const a = await getStreamBridge();
    const b = await getStreamBridge();
    expect(a).toBe(b);
    await resetStreamBridge();
    const c = await getStreamBridge();
    expect(c).not.toBe(a);
  });
});
