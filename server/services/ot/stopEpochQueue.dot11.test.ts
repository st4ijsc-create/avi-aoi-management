/**
 * doc 81 Đợt 11 K-fix / K-fix 2 — PURE checks (no DB, no real driver) of the queue and the STOP epoch:
 *   R-11-h a PROTECTIVE interlock action is never cancelled by a STOP and keeps its place (R-11-k 3: unless it overrides a pin);
 *   R-11-i (a) ordinary commands (a stop-LABELLED one with arbitrary writes too) are capped (BUSY when full) and cancelled by a STOP;
 *   R-11-d / R-11-i (b) the STOP epoch: who records it (stopEpochAtGatesFor), the check right before the device write, and the bump
 *     only when a TRUE stop is SENT (executeOtDeviceWrite bumpStopEpoch).
 * doc 81 Đợt 11 simplify (owner ruling R-11-n, 2026-10-14) — the STOP lane / groups / coalescing / pin-at-send are GONE. A verified STOP
 *   (the pinned stop, or a stop by content) is a `priorityStop` job: it waits only for the command in flight (and earlier STOPs), cancels
 *   the waiting commands (R-1E-a / R-1E-b), and an IDENTICAL pinned STOP already waiting or in flight is not queued again — its caller
 *   gets that STOP's real outcome. An unverified stop-typed command is an ordinary queued command that is never BUSY: a full queue ⇒ it
 *   waits for a slot. The lane tests of the final fix wave were removed or rewritten here (simplify-report.md lists each one and why).
 * Oracles are written by the test (job run log, driver write log), never read from product state.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  tryEnqueueAdapterCommand,
  _resetAdapterCommandQueuesForTests,
  _adapterCommandQueueDepthForTests,
  stopEpochAtGatesFor,
  writesOverrideStopPin,
  type DispatchInput,
} from "./commandDispatcher";
import * as dw from "./otDeviceWrite";
import {
  adapterStopEpoch,
  bumpAdapterStopEpoch,
  executeOtDeviceWrite,
  executeOtDeviceWriteUnlessStopped,
  isStoppedBeforeWrite,
  onPinnedStopQueued,
  type OtResolvedWrite,
} from "./otDeviceWrite";

const SUPERSEDED = { superseded: true, byStop: true };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}
function makeJobs() {
  const log: string[] = [];
  const ctl = new Map<string, ReturnType<typeof deferred<string>>>();
  const job = (name: string) => {
    const d = deferred<string>();
    ctl.set(name, d);
    return () => {
      log.push(name);
      return d.promise;
    };
  };
  return { log, ctl, job };
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
function accepted<T>(o: ReturnType<typeof tryEnqueueAdapterCommand<T>>) {
  if (!o.accepted) throw new Error(`expected accepted, got BUSY depth=${o.depth} max=${o.max}`);
  return o.result;
}
const rw = (tagKey: string, value: unknown): OtResolvedWrite => ({ write: { tagKey, value }, address: `a-${tagKey}`, dataType: "int" });

const savedMax = process.env.OT_CMD_QUEUE_MAX;
beforeEach(() => {
  _resetAdapterCommandQueuesForTests();
  process.env.OT_CMD_QUEUE_MAX = "2";
});
afterEach(() => {
  if (savedMax === undefined) delete process.env.OT_CMD_QUEUE_MAX;
  else process.env.OT_CMD_QUEUE_MAX = savedMax;
  _resetAdapterCommandQueuesForTests();
});

describe("R-11-n — a verified STOP waits only for the in-flight command; no lane, no group, an identical STOP shares the one in flight", () => {
  const A = 5151;
  /** a pinned STOP job (identical key ⇒ shared); `wire` records the device writes it performs */
  const stopJob = (wire: string[], name: string, outcome: unknown = name) => () => {
    wire.push(name);
    return Promise.resolve(outcome);
  };

  it("★ STOP FLOOD of IDENTICAL pinned STOPs while a write is in flight ⇒ ONE queue entry (depth 2), ONE device write, all 50 answered with that write's outcome, every caller's intents on it", async () => {
    const { ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(A, job("A")));
    const wire: string[] = [];
    const intents: number[] = [1];
    const results: Array<Promise<unknown>> = [];
    let joined = 0;
    for (let i = 0; i < 50; i++) {
      const o = tryEnqueueAdapterCommand(A, stopJob(wire, `S${i}`, { outcome: "S0's write" }), { priorityStop: true, identicalStopKey: "K", shareIntentIds: i === 0 ? intents : [100 + i], stopRef: { k: `S${i}` } });
      if (o.accepted && o.joined) joined++;
      results.push(accepted(o));
      expect(_adapterCommandQueueDepthForTests(A)).toBeLessThanOrEqual(2);
    }
    expect(joined).toBe(49);
    expect(dw._stopCallersForTests(A)).toBe(50);
    ctl.get("A")!.resolve("a");
    expect(await rA).toBe("a");
    for (const r of await Promise.all(results)) expect(r).toEqual({ outcome: "S0's write" });
    expect(wire).toEqual(["S0"]); // ONE device write
    expect(intents).toHaveLength(50); // the one write carries every caller's ledger intent (late-result review, STOP watch)
    await flush();
    expect(_adapterCommandQueueDepthForTests(A)).toBe(0);
  });

  it("★ an identical STOP arriving while the first one's write is IN FLIGHT shares its outcome and moves the epoch now; once that write has answered, an identical STOP is sent anew", async () => {
    const wire: string[] = [];
    const d = deferred<string>();
    const p1 = accepted(tryEnqueueAdapterCommand(A, () => (wire.push("P1"), d.promise), { priorityStop: true, identicalStopKey: "K", stopRef: { k: "P1" } }));
    await flush(); // P1's write is on the wire
    const e0 = adapterStopEpoch(A);
    const o2 = tryEnqueueAdapterCommand(A, stopJob(wire, "P2"), { priorityStop: true, identicalStopKey: "K", stopRef: { k: "P2" } });
    expect(o2.accepted && o2.joined).toBe(true);
    expect(adapterStopEpoch(A)).toBeGreaterThan(e0); // P2 is executed by P1's identical write: a write whose gates began before P2 is cancelled
    d.resolve("P1 outcome");
    expect(await p1).toBe("P1 outcome");
    expect(await accepted(o2)).toBe("P1 outcome");
    const o3 = tryEnqueueAdapterCommand(A, stopJob(wire, "P3"), { priorityStop: true, identicalStopKey: "K" });
    expect(o3.accepted && o3.joined).toBeFalsy();
    expect(await accepted(o3)).toBe("P3");
    expect(wire).toEqual(["P1", "P3"]);
  });

  it("★ a STOP whose write TIMED OUT is not shared while its slot is held (B3): an identical STOP pressed again is a fresh device write", async () => {
    const wire: string[] = [];
    let releaseHold!: () => void;
    const hold = new Promise<void>((r) => (releaseHold = r));
    const p1 = accepted(tryEnqueueAdapterCommand(A, stopJob(wire, "P1", "timeout"), { priorityStop: true, identicalStopKey: "K", holdSlot: () => hold }));
    expect(await p1).toBe("timeout");
    const o2 = tryEnqueueAdapterCommand(A, stopJob(wire, "P2", "acked"), { priorityStop: true, identicalStopKey: "K" });
    expect(o2.accepted && o2.joined).toBeFalsy();
    releaseHold();
    expect(await accepted(o2)).toBe("acked");
    expect(wire).toEqual(["P1", "P2"]);
  });

  it("★ STOPs with DIFFERENT writes are never shared — each is its own queue entry and device write, in arrival order, each with its own outcome; a STOP without a key is never shared", async () => {
    const { ctl, job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const wire: string[] = [];
    const s1 = tryEnqueueAdapterCommand(A, stopJob(wire, "S1"), { priorityStop: true, identicalStopKey: "K1" });
    const s2 = tryEnqueueAdapterCommand(A, stopJob(wire, "S2"), { priorityStop: true, identicalStopKey: "K2" });
    const s3 = tryEnqueueAdapterCommand(A, stopJob(wire, "S3"), { priorityStop: true }); // a content stop: no key
    const s4 = tryEnqueueAdapterCommand(A, stopJob(wire, "S4"), { priorityStop: true });
    expect([s1, s2, s3, s4].map((o) => o.accepted && o.joined === true)).toEqual([false, false, false, false]);
    expect(dw._adapterQueueLineForTests(A)).toEqual([{ cls: "stop", callers: 1 }, { cls: "stop", callers: 1 }, { cls: "stop", callers: 1 }, { cls: "stop", callers: 1 }]);
    ctl.get("A")!.resolve("a");
    expect(await Promise.all([s1, s2, s3, s4].map((o) => accepted(o)))).toEqual(["S1", "S2", "S3", "S4"]);
    expect(wire).toEqual(["S1", "S2", "S3", "S4"]);
  });

  it("identicalStopKey: the same writes in the same order on the same connection only — another value / address / scale / order is another key", () => {
    const k = (w: OtResolvedWrite[]) => dw.identicalStopKey(A, w);
    const base = k([rw("run", 0), rw("speed", 0)]);
    expect(base).not.toBeNull();
    expect(k([rw("run", 0), rw("speed", 0)])).toBe(base);
    expect(k([rw("run", 1), rw("speed", 0)])).not.toBe(base);
    expect(k([{ ...rw("run", 0), address: "other" }, rw("speed", 0)])).not.toBe(base);
    expect(k([{ ...rw("run", 0), scale: 10 }, rw("speed", 0)])).not.toBe(base);
    expect(k([rw("speed", 0), rw("run", 0)])).not.toBe(base); // order: the shared outcome's indexes are per write position
    expect(k([rw("run", BigInt(1) as unknown as number)])).not.toBe(base);
  });

  it("★ R-1E-a: a STOP cancels the WAITING ordinary commands and runs right after the in-flight one", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rW1 = accepted(tryEnqueueAdapterCommand(A, job("W1")));
    const rW2 = accepted(tryEnqueueAdapterCommand(A, job("W2")));
    const rS = accepted(tryEnqueueAdapterCommand(A, job("S"), { priorityStop: true, stopRef: { k: "S" } }));
    expect(await rW1).toEqual({ ...SUPERSEDED, stop: { k: "S" } });
    expect(await rW2).toEqual({ ...SUPERSEDED, stop: { k: "S" } });
    ctl.get("A")!.resolve("a");
    await flush();
    ctl.get("S")!.resolve("s");
    expect(await rS).toBe("s");
    expect(log).toEqual(["A", "S"]);
  });

  it("★ an UNVERIFIED stop (waitForSlot) on a FULL queue is never BUSY: it waits for a slot, FIFO, ahead of anything newer; an ordinary command is BUSY meanwhile", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "1";
    accepted(tryEnqueueAdapterCommand(A, job("A"))); // FULL
    expect(tryEnqueueAdapterCommand(A, job("X")).accepted).toBe(false);
    const rU1 = accepted(tryEnqueueAdapterCommand(A, job("U1"), { waitForSlot: true }));
    const rU2 = accepted(tryEnqueueAdapterCommand(A, job("U2"), { waitForSlot: true }));
    expect(dw._adapterSlotWaitersForTests(A)).toBe(2);
    expect(_adapterCommandQueueDepthForTests(A)).toBe(1); // the cap holds: waiting for a slot is not a queue entry
    process.env.OT_CMD_QUEUE_MAX = "10";
    expect(tryEnqueueAdapterCommand(A, job("Y")).accepted).toBe(false); // a stop waits for a slot ⇒ it goes first
    process.env.OT_CMD_QUEUE_MAX = "1";
    ctl.get("A")!.resolve("a");
    await flush();
    ctl.get("U1")!.resolve("u1");
    expect(await rU1).toBe("u1");
    await flush();
    ctl.get("U2")!.resolve("u2");
    expect(await rU2).toBe("u2");
    expect(log).toEqual(["A", "U1", "U2"]);
    await flush();
    expect(dw._adapterCommandQueueCountForTests()).toBe(0);
  });

  it("★ R-11-n: an UNVERIFIED stop with room is FIFO behind the waiting writes and cancels nothing; it tells no re-check listener", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    const seen: unknown[] = [];
    const off = onPinnedStopQueued(A, (ref) => seen.push(ref));
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rW = accepted(tryEnqueueAdapterCommand(A, job("W")));
    const rL = accepted(tryEnqueueAdapterCommand(A, job("L"), { protective: true, overridesStopPin: true }));
    const rU = accepted(tryEnqueueAdapterCommand(A, job("U"), { waitForSlot: true }));
    off();
    for (const n of ["A", "W", "L", "U"]) {
      await flush();
      ctl.get(n)!.resolve(n);
    }
    expect([await rW, await rL, await rU]).toEqual(["W", "L", "U"]);
    expect(log).toEqual(["A", "W", "L", "U"]);
    expect(seen).toEqual([]);
  });

  it("★ R-1E-b (kept): a VERIFIED STOP cancels an unverified stop still WAITING — in the queue or for a slot; one issued after the STOP runs after it", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "2";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rU1 = accepted(tryEnqueueAdapterCommand(A, job("U1"), { waitForSlot: true })); // in the queue (depth 2 = FULL)
    const rU2 = accepted(tryEnqueueAdapterCommand(A, job("U2"), { waitForSlot: true })); // waits for a slot
    const rS = accepted(tryEnqueueAdapterCommand(A, job("S"), { priorityStop: true, stopRef: { k: "S" } }));
    expect(await rU1).toEqual({ ...SUPERSEDED, stop: { k: "S" } });
    expect(await rU2).toEqual({ ...SUPERSEDED, stop: { k: "S" } });
    expect(dw._adapterSlotWaitersForTests(A)).toBe(0);
    const rU3 = accepted(tryEnqueueAdapterCommand(A, job("U3"), { waitForSlot: true }));
    for (const n of ["A", "S", "U3"]) {
      await flush();
      ctl.get(n)!.resolve(n);
    }
    expect([await rS, await rU3]).toEqual(["S", "U3"]);
    expect(log).toEqual(["A", "S", "U3"]);
  });

  it("★ R-11-k (3) (kept): a VERIFIED STOP cancels a waiting protective action that writes a pinned stop tag with a non-pin value; it keeps one that does not", async () => {
    const { ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rL = accepted(tryEnqueueAdapterCommand(A, job("L"), { protective: true }));
    const rO = accepted(tryEnqueueAdapterCommand(A, job("O"), { protective: true, overridesStopPin: true }));
    const rS = accepted(tryEnqueueAdapterCommand(A, job("S"), { priorityStop: true, stopRef: { k: "S" } }));
    expect(await rO).toEqual({ ...SUPERSEDED, stop: { k: "S" } });
    for (const n of ["A", "S", "L"]) {
      await flush();
      ctl.get(n)!.resolve(n);
    }
    expect(await rS).toBe("S");
    expect(await rL).toBe("L");
  });

  it("an ordinary command is capped (BUSY when full) — a protective one too; a STOP never is", () => {
    const { job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    accepted(tryEnqueueAdapterCommand(A, job("B")));
    expect(tryEnqueueAdapterCommand(A, job("X")).accepted).toBe(false);
    expect(tryEnqueueAdapterCommand(A, job("L"), { protective: true }).accepted).toBe(false);
    expect(tryEnqueueAdapterCommand(A, job("S"), { priorityStop: true }).accepted).toBe(true);
    expect(_adapterCommandQueueDepthForTests(A)).toBe(2); // B was cancelled, the STOP took one slot
  });

  it("tells the in-flight re-check listeners about every VERIFIED STOP (pinned:false for a content stop, true for the pin), also when it is dropped onto an identical one", () => {
    const seen: unknown[] = [];
    const off = onPinnedStopQueued(A, (ref, info) => seen.push({ ref, info }));
    const { job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    tryEnqueueAdapterCommand(A, job("C"), { priorityStop: true, stopRef: { k: "C", contentStop: true } });
    tryEnqueueAdapterCommand(A, job("P"), { priorityStop: true, identicalStopKey: "K", stopRef: { k: "P" } });
    tryEnqueueAdapterCommand(A, job("P2"), { priorityStop: true, identicalStopKey: "K", stopRef: { k: "P2" } });
    tryEnqueueAdapterCommand(A, job("U"), { waitForSlot: true });
    off();
    expect(seen).toEqual([
      { ref: { k: "C", contentStop: true }, info: { pinned: false } },
      { ref: { k: "P" }, info: { pinned: true } },
      { ref: { k: "P2" }, info: { pinned: true } },
    ]);
  });

  it("★ scan #108 moot (R-11-n): no stop GROUP exists — 12 distinct pinned STOPs are 12 single-write queue entries that count against the cap (ordinary writes see BUSY), each answered from its own write; the lane API is gone", async () => {
    const { ctl, job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A0, job("A")));
    const wire: string[] = [];
    const outs = Array.from({ length: 12 }, (_, i) => tryEnqueueAdapterCommand(A0, stopJob(wire, `t${i}`), { priorityStop: true, identicalStopKey: `K${i}` }));
    expect(_adapterCommandQueueDepthForTests(A0)).toBe(13);
    expect(tryEnqueueAdapterCommand(A0, job("W")).accepted).toBe(false); // the STOPs are queue entries: the cap holds for everything else
    expect(dw._adapterQueueLineForTests(A0).every((x) => x.cls === "stop" && x.callers === 1)).toBe(true);
    for (const gone of ["enqueueStopLane", "projectExecutedForMember", "applyPinsAtSend", "stopLaneWriteSetKey", "OT_STOP_LANE_UNVERIFIED_MAX", "_stopLaneWaitingMembersForTests"]) expect(gone in dw).toBe(false);
    ctl.get("A")!.resolve("a");
    expect(await Promise.all(outs.map((o) => accepted(o)))).toEqual(Array.from({ length: 12 }, (_, i) => `t${i}`));
    expect(wire).toHaveLength(12);
  });
});
const A0 = 7171;


describe("R-11-d / R-11-i (b) — the per-adapter STOP epoch", () => {
  const A = 6161;
  const base = (over: Partial<DispatchInput>): DispatchInput => ({
    adapterId: A,
    commandType: "set",
    writes: [{ tagKey: "t", value: 1 }],
    triggeredBy: { kind: "hitl", requestedBy: 1 },
    idempotencyKey: "k",
    ...over,
  });

  it("★ who records it (R-11-j, R-11-k 3): an ordinary write does; a TRUE stop, ANY stop-typed command (unverified too) and an interlock action that keeps the pins do not; an interlock action overriding a pin does", () => {
    const il = { kind: "interlock" as const, ruleId: 1, eventId: 1, approvedBy: 1 };
    expect(stopEpochAtGatesFor(base({}), { trueStop: false, epochAtGates: 7 })).toBe(7);
    expect(stopEpochAtGatesFor(base({ commandType: "stop" }), { trueStop: false, epochAtGates: 7 })).toBeNull(); // unverified stop: never epoch-cancelled
    expect(stopEpochAtGatesFor(base({ commandType: "e_stop" }), { trueStop: false, epochAtGates: 7 })).toBeNull();
    expect(stopEpochAtGatesFor(base({ commandType: "stop" }), { trueStop: true, epochAtGates: 7 })).toBeNull();
    expect(stopEpochAtGatesFor(base({ commandType: "stop_line", triggeredBy: il }), { trueStop: false, epochAtGates: 7 })).toBeNull();
    expect(stopEpochAtGatesFor(base({ commandType: "reduce_speed", triggeredBy: il }), { trueStop: false, epochAtGates: 7, overridesStopPin: true })).toBe(7);
  });

  it("R-11-k (3) writesOverrideStopPin: a write to a pinned tag with a non-pin value overrides it; the pin value, or an unpinned tag, does not", () => {
    const pins = [{ tagKey: "speed_sp", value: 0 }, { tagKey: "run", value: false }];
    expect(writesOverrideStopPin([{ tagKey: "speed_sp", value: 30 }], pins)).toBe(true);
    expect(writesOverrideStopPin([{ tagKey: "speed_sp", value: 0 }], pins)).toBe(false);
    expect(writesOverrideStopPin([{ tagKey: "run", value: 0 }], pins)).toBe(false); // 0 ≡ false for a boolean pin (the pin match rule)
    expect(writesOverrideStopPin([{ tagKey: "block", value: true }], pins)).toBe(false);
    expect(writesOverrideStopPin([{ tagKey: "block", value: true }, { tagKey: "run", value: true }], pins)).toBe(true);
  });

  it("strictly increasing, per adapter", () => {
    const a1 = bumpAdapterStopEpoch(A);
    const other = adapterStopEpoch(A + 1);
    const a2 = bumpAdapterStopEpoch(A);
    expect(a2).toBeGreaterThan(a1);
    expect(adapterStopEpoch(A)).toBe(a2);
    expect(adapterStopEpoch(A + 1)).toBe(other);
  });

  function fakeDriver() {
    const writes: string[] = [];
    return {
      writes,
      driver: {
        writeTags: async (w: Array<{ tagKey: string; value: unknown }>) => {
          for (const x of w) writes.push(`${x.tagKey}=${String(x.value)}`);
          return w.map((x) => ({ tagKey: x.tagKey, ok: true }));
        },
        readTags: async () => [],
      } as never,
    };
  }
  const stage = (driver: never, over: { stopTyped: boolean; value?: number; stopEpochAtGates: number | null; bumpStopEpoch?: boolean }) => ({
    input: base({ commandType: over.stopTyped ? "stop" : "set", writes: [{ tagKey: "t", value: over.value ?? 1 }] }),
    driver,
    resolved: [{ write: { tagKey: "t", value: over.value ?? 1 }, address: "40001", dataType: "int" }],
    driverWrites: [{ tagKey: "t", address: "40001", value: over.value ?? 1, dataType: "int" as never }],
    timeoutMs: 1000,
    stopTyped: over.stopTyped,
    ledger: { intentIds: [], confirmedBy: 1 },
    stopEpochAtGates: over.stopEpochAtGates,
    ...(over.bumpStopEpoch !== undefined ? { bumpStopEpoch: over.bumpStopEpoch } : {}),
  });

  it("a write whose epoch moved is cancelled — a stop-LABELLED one too: nothing reaches the driver, the STOP is named", async () => {
    const { driver, writes } = fakeDriver();
    const atGates = adapterStopEpoch(A);
    const now = bumpAdapterStopEpoch(A, { idempotencyKey: "S1" });
    const r = await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: false, stopEpochAtGates: atGates }));
    expect(r).toEqual({ stoppedBeforeWrite: true, epochAtGates: atGates, epochNow: now, stop: { idempotencyKey: "S1" } });
    const r2 = await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: true, stopEpochAtGates: atGates, bumpStopEpoch: false }));
    expect(isStoppedBeforeWrite(r2)).toBe(true);
    expect(writes).toEqual([]);
  });

  it("controls: unchanged epoch ⇒ written; null epoch (true stop / protective interlock) ⇒ never cancelled", async () => {
    const { driver, writes } = fakeDriver();
    const r1 = await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: false, stopEpochAtGates: adapterStopEpoch(A), value: 1 }));
    expect(isStoppedBeforeWrite(r1)).toBe(false);
    bumpAdapterStopEpoch(A);
    const r3 = await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: false, stopEpochAtGates: null, value: 3 }));
    expect(isStoppedBeforeWrite(r3)).toBe(false);
    expect(writes).toEqual(["t=1", "t=3"]);
  });

  it("the bump happens only when a TRUE stop is SENT: bumpStopEpoch true ⇒ moved; false (a stop-labelled arbitrary write) ⇒ not; absent ⇒ the stop type decides (central fallback / sweep STOP)", async () => {
    const { driver } = fakeDriver();
    const e0 = adapterStopEpoch(A);
    await executeOtDeviceWrite(stage(driver, { stopTyped: true, stopEpochAtGates: null, bumpStopEpoch: false }));
    expect(adapterStopEpoch(A)).toBe(e0);
    await executeOtDeviceWrite(stage(driver, { stopTyped: false, stopEpochAtGates: null, bumpStopEpoch: true }));
    const e1 = adapterStopEpoch(A);
    expect(e1).toBeGreaterThan(e0);
    await executeOtDeviceWrite(stage(driver, { stopTyped: true, stopEpochAtGates: null }));
    const e2 = adapterStopEpoch(A);
    expect(e2).toBeGreaterThan(e1);
    await executeOtDeviceWrite(stage(driver, { stopTyped: false, stopEpochAtGates: null }));
    expect(adapterStopEpoch(A)).toBe(e2);
  });

  it("a cancelled write (epoch moved) does not bump, even if marked as a stop", async () => {
    const { driver } = fakeDriver();
    const atGates = adapterStopEpoch(A);
    const now = bumpAdapterStopEpoch(A);
    await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: false, stopEpochAtGates: atGates, bumpStopEpoch: true }));
    expect(adapterStopEpoch(A)).toBe(now);
  });
});
