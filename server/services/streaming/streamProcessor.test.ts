/**
 * doc 44 W4 / G2.8 — StreamProcessor + WatermarkWindower tests.
 *   • tumbling event-time windows close only when the WATERMARK passes their end
 *   • late data reopens an emitted window → re-emitted with corrected:true
 *   • data past the retention horizon is dropped (honest, bounded)
 *   • idempotency: repeated (dedupeKey) counts once
 *   • derived _line payload: throughput + honest-null ng-rate
 *   • processor enriches per-asset windows → one _line node per line (mocked enrich)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  WatermarkWindower,
  buildDerivedLinePayload,
  patternEnrichResolver,
  defaultOutcomeClassifier,
  StreamProcessor,
  type ClosedWindow,
} from "./streamProcessor";
import { createInProcessStreamBridge } from "./inProcessAdapter";

const W = 60_000; // 1-minute window

describe("WatermarkWindower — tumbling + watermark", () => {
  it("a window closes only once the watermark passes its end", () => {
    const win = new WatermarkWindower({ windowMs: W, allowedLatenessMs: 0 });
    expect(win.add({ groupKey: "L1", ts: 1_000, dedupeKey: "a" })).toBe("accepted");
    expect(win.add({ groupKey: "L1", ts: 2_000, dedupeKey: "b" })).toBe("accepted");
    // watermark = maxEventTs(2000) → window [0,60000) not yet closable
    expect(win.collectClosed()).toEqual([]);
    // push event time to 60000 → watermark 60000 ≥ window end → closes
    win.add({ groupKey: "L1", ts: 60_000, dedupeKey: "c" });
    const closed = win.collectClosed();
    expect(closed).toHaveLength(1);
    expect(closed[0].windowStart).toBe(0);
    expect(closed[0].count).toBe(2);
    expect(closed[0].corrected).toBe(false);
  });

  it("does not re-emit an already-closed window with no new data", () => {
    const win = new WatermarkWindower({ windowMs: W, allowedLatenessMs: 0 });
    win.add({ groupKey: "L1", ts: 1_000, dedupeKey: "a" });
    win.add({ groupKey: "L1", ts: 61_000, dedupeKey: "b" });
    expect(win.collectClosed()).toHaveLength(1);
    expect(win.collectClosed()).toEqual([]); // second collect → nothing
  });
});

describe("WatermarkWindower — late data + retention", () => {
  it("a late event reopens an emitted window → corrected re-emit", () => {
    const win = new WatermarkWindower({ windowMs: W, allowedLatenessMs: 30_000 });
    win.add({ groupKey: "L1", ts: 10_000, dedupeKey: "a", outcome: "ok" });
    // advance watermark to 95000-30000 = 65000 ≥ 60000 → window [0,60000) closes
    win.add({ groupKey: "L1", ts: 95_000, dedupeKey: "b" });
    const first = win.collectClosed();
    expect(first.find((w) => w.windowStart === 0)?.corrected).toBe(false);

    // late event landing back in [0,60000) (still retained) → correction
    expect(win.add({ groupKey: "L1", ts: 30_000, dedupeKey: "late", outcome: "ng" })).toBe("accepted");
    const corrected = win.collectClosed();
    const c = corrected.find((w) => w.windowStart === 0);
    expect(c).toBeTruthy();
    expect(c!.corrected).toBe(true);
    expect(c!.count).toBe(2); // original ok + late ng
    expect(c!.ngCount).toBe(1);
  });

  it("an event past the retention horizon is dropped", () => {
    const win = new WatermarkWindower({ windowMs: W, allowedLatenessMs: 30_000 });
    win.add({ groupKey: "L1", ts: 200_000, dedupeKey: "hi" }); // watermark 170000, horizon 140000
    // window [0,60000) end 60000 ≤ horizon 140000 and never seen → too late
    expect(win.add({ groupKey: "L1", ts: 10_000, dedupeKey: "old" })).toBe("dropped-late");
  });

  it("gc drops emitted windows past the retention horizon", () => {
    const win = new WatermarkWindower({ windowMs: W, allowedLatenessMs: 10_000 });
    win.add({ groupKey: "L1", ts: 1_000, dedupeKey: "a" });
    win.add({ groupKey: "L1", ts: 500_000, dedupeKey: "b" }); // huge advance
    win.collectClosed(); // close [0,60000)
    win.gc();
    expect(win.size()).toBeLessThanOrEqual(1); // old window collected away
  });
});

describe("WatermarkWindower — idempotency", () => {
  it("a repeated dedupeKey is counted once", () => {
    const win = new WatermarkWindower({ windowMs: W, allowedLatenessMs: 0 });
    expect(win.add({ groupKey: "L1", ts: 1_000, dedupeKey: "dup" })).toBe("accepted");
    expect(win.add({ groupKey: "L1", ts: 1_000, dedupeKey: "dup" })).toBe("duplicate");
    win.add({ groupKey: "L1", ts: 61_000, dedupeKey: "x" });
    const closed = win.collectClosed().find((w) => w.windowStart === 0);
    expect(closed!.count).toBe(1);
  });
});

describe("buildDerivedLinePayload", () => {
  const enrich = { site: "hanoi", area: "smt", line: "l1", product: "P1", shift: "A" };
  it("derives throughput + ng-rate", () => {
    const w: ClosedWindow = {
      groupKey: "l1", windowStart: 0, windowEnd: W, count: 10, okCount: 8, ngCount: 2, corrected: false,
    };
    const p = buildDerivedLinePayload(w, enrich) as any;
    expect(p.path).toBe("hanoi/smt/l1/_line");
    expect(p.state).toBe("EXECUTE");
    expect(p.values.event_count).toBe(10);
    expect(p.values.throughput_per_min).toBe(10); // 10 events / 1 min
    expect(p.values.ng_rate_pct).toBe(20);
    expect(p.product).toBe("P1");
    expect(p.corrected).toBe(false);
    expect(p.window.event_time).toBe(true);
  });
  it("ng-rate is honest-null when no outcome info was present", () => {
    const w: ClosedWindow = {
      groupKey: "l1", windowStart: 0, windowEnd: W, count: 5, okCount: 0, ngCount: 0, corrected: false,
    };
    const p = buildDerivedLinePayload(w, enrich) as any;
    expect(p.values.ng_rate_pct).toBeNull();
    expect(p.values.throughput_per_min).toBe(5);
  });
});

describe("patternEnrichResolver / defaultOutcomeClassifier", () => {
  it("parses line from a canonical/sim asset id, else unassigned", () => {
    expect(patternEnrichResolver("SIM-L2-CONVEYOR")).toMatchObject({ line: "l2" });
    expect(patternEnrichResolver("weird-id")).toMatchObject({ line: "unassigned" });
  });
  it("classifies explicit + meta outcomes, else null", () => {
    expect(defaultOutcomeClassifier({ outcome: "ng" })).toBe("ng");
    expect(defaultOutcomeClassifier({ meta: { overallResult: "NG" } })).toBe("ng");
    expect(defaultOutcomeClassifier({ meta: { result: "PASS" } })).toBe("ok");
    expect(defaultOutcomeClassifier({ metric: "temp", value: 42 })).toBeNull();
  });
});

describe("StreamProcessor — enrich + rollup + emit", () => {
  let bridge: ReturnType<typeof createInProcessStreamBridge>;
  let emitted: Array<{ topic: string; payload: any }>;
  let proc: StreamProcessor;

  beforeEach(() => {
    bridge = createInProcessStreamBridge();
    emitted = [];
    proc = new StreamProcessor({
      bridge,
      emit: (topic, payload) => void emitted.push({ topic, payload }),
      // enrich by the device's line number
      enrich: (assetId) => {
        const m = /-L(\d+)-/.exec(assetId);
        return { site: "s", area: "a", line: m ? `l${m[1]}` : "unassigned" };
      },
      windowMs: W,
      allowedLatenessMs: 0,
    });
  });
  afterEach(async () => {
    proc.stop();
    await bridge.close();
  });

  it("rolls up two assets on the same line into ONE _line node per window", async () => {
    proc.onMessage({
      topic: "syn/telemetry/l1",
      seq: 1,
      ts: Date.now(),
      payload: [
        { deviceId: "SIM-L1-DEV0", ts: 1_000, metric: "x", value: 1, outcome: "ok" },
        { deviceId: "SIM-L1-DEV1", ts: 2_000, metric: "x", value: 1, outcome: "ng" },
      ],
    });
    // advance watermark to close [0,60000)
    proc.onMessage({
      topic: "syn/telemetry/l1",
      seq: 2,
      ts: Date.now(),
      payload: [{ deviceId: "SIM-L1-DEV0", ts: 61_000, metric: "x", value: 1 }],
    });
    const n = await proc.flush();
    expect(n).toBe(1); // both devices → one l1 node
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload.path).toBe("s/a/l1/_line");
    expect(emitted[0].payload.values.event_count).toBe(2);
    expect(emitted[0].payload.values.ng_count).toBe(1);
    expect(emitted[0].payload.corrected).toBe(false);
  });

  it("idempotent across a replayed message (same seq) — no double count", async () => {
    const msg = {
      topic: "syn/telemetry/l1",
      seq: 7,
      ts: Date.now(),
      payload: [{ deviceId: "SIM-L1-DEV0", ts: 5_000, metric: "x", value: 1, outcome: "ok" as const }],
    };
    proc.onMessage(msg);
    proc.onMessage(msg); // replay of the identical stream message
    proc.onMessage({
      topic: "syn/telemetry/l1",
      seq: 8,
      ts: Date.now(),
      payload: [{ deviceId: "SIM-L1-DEV0", ts: 61_000, metric: "x", value: 1 }],
    });
    await proc.flush();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload.values.event_count).toBe(1); // replay did not double count
  });

  it("late data emits a corrected _line node", async () => {
    proc = new StreamProcessor({
      bridge,
      emit: (topic, payload) => void emitted.push({ topic, payload }),
      enrich: () => ({ site: "s", area: "a", line: "l1" }),
      windowMs: W,
      allowedLatenessMs: 30_000,
    });
    proc.onMessage({ topic: "t", seq: 1, ts: Date.now(), payload: [{ deviceId: "SIM-L1-DEV0", ts: 10_000, metric: "x", value: 1, outcome: "ok" }] });
    proc.onMessage({ topic: "t", seq: 2, ts: Date.now(), payload: [{ deviceId: "SIM-L1-DEV0", ts: 95_000, metric: "x", value: 1 }] });
    await proc.flush(); // closes [0,60000)
    emitted.length = 0;
    // late sample back in [0,60000)
    proc.onMessage({ topic: "t", seq: 3, ts: Date.now(), payload: [{ deviceId: "SIM-L1-DEV0", ts: 30_000, metric: "x", value: 1, outcome: "ng" }] });
    await proc.flush();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload.corrected).toBe(true);
    expect(emitted[0].payload.values.ng_count).toBe(1);
  });

  it("start() is a no-op while STREAM_PROCESSOR_ENABLED is unset", () => {
    proc.start();
    expect(proc.status().running).toBe(false);
  });
});
