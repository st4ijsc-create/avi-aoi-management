/**
 * doc 81 Đợt 11 K-fix / K-fix 2 — PURE checks (no DB, no real driver) of the queue and the STOP epoch:
 *   R-11-i (c) the BOUNDED stop lane (enqueueStopLane): per adapter one STOP in flight + ONE waiting group; more STOPs JOIN the
 *     waiting group (no queue entry, no extra device write); members' results resolve together, projected on their own writes;
 *   R-11-h a PROTECTIVE interlock action is never cancelled by a STOP (lane or legacy priorityStop) and keeps its place;
 *   R-11-i (a) ordinary commands (a stop-LABELLED one with arbitrary writes too) are capped (BUSY when full) and cancelled by a STOP;
 *   R-11-d / R-11-i (b) the STOP epoch: who records it (stopEpochAtGatesFor), the check right before the device write, and the bump
 *     only when a TRUE stop is SENT (executeOtDeviceWrite bumpStopEpoch).
 * Oracles are written by the test (job run log, driver write log), never read from product state.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  tryEnqueueAdapterCommand,
  _resetAdapterCommandQueuesForTests,
  _adapterCommandQueueDepthForTests,
  stopEpochAtGatesFor,
  type DispatchInput,
} from "./commandDispatcher";
import {
  adapterStopEpoch,
  bumpAdapterStopEpoch,
  enqueueStopLane,
  executeOtDeviceWrite,
  executeOtDeviceWriteUnlessStopped,
  isStoppedBeforeWrite,
  onPinnedStopQueued,
  projectExecutedForMember,
  _stopLaneWaitingMembersForTests,
  type ExecutedWrite,
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
/** a fake device-stage execution of a union: logs the union, answers acked per write */
function laneExec(log: string[], gate?: Promise<void>) {
  return async (union: OtResolvedWrite[]): Promise<ExecutedWrite> => {
    log.push(union.map((u) => `${u.write.tagKey}=${String(u.write.value)}`).join(","));
    if (gate) await gate;
    return { sentAt: new Date(0), timedOut: false, outcomes: union.map((u, idx) => ({ idx, ok: true, status: "acked" as const, errorText: null, readBackValue: u.write.tagKey })) };
  };
}

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

describe("R-11-i (c) — the bounded STOP lane", () => {
  const A = 5151;

  it("★ STOP FLOOD: 50 STOPs while a write is in flight ⇒ ONE waiting group (depth ≤ 2), ONE device write of the union, all 50 resolve together", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(A, job("A"))); // in flight
    const wire: string[] = [];
    const results: Array<Promise<ExecutedWrite>> = [];
    let joined = 0;
    for (let i = 0; i < 50; i++) {
      const own = i % 2 ? [rw("run", 0)] : [rw("speed", 0)];
      const r = enqueueStopLane(A, own, laneExec(wire), projectExecutedForMember, { stopRef: { k: `S${i}` } });
      if (r.joined) joined++;
      results.push(r.result);
      expect(_adapterCommandQueueDepthForTests(A)).toBeLessThanOrEqual(2);
    }
    expect(joined).toBe(49);
    expect(_stopLaneWaitingMembersForTests(A)).toBe(50);
    expect(_adapterCommandQueueDepthForTests(A)).toBe(2); // A + one STOP group
    ctl.get("A")!.resolve("a");
    expect(await rA).toBe("a");
    const all = await Promise.all(results);
    expect(wire).toEqual(["speed=0,run=0"]); // ONE device write: the union
    expect(log).toEqual(["A"]);
    for (const [i, r] of all.entries()) {
      // projected on its OWN write: re-indexed to 0, the outcome of ITS tag in the union
      expect(r.outcomes).toEqual([{ idx: 0, ok: true, status: "acked", errorText: null, readBackValue: i % 2 ? "run" : "speed" }]);
    }
    await flush();
    expect(_adapterCommandQueueDepthForTests(A)).toBe(0);
  });

  it("at most ONE in flight + ONE waiting: a STOP arriving while the first group RUNS forms the next group; later ones join that one", async () => {
    const wire: string[] = [];
    const g1 = deferred<void>();
    const s1 = enqueueStopLane(A, [rw("speed", 0)], laneExec(wire, g1.promise), projectExecutedForMember);
    await flush();
    expect(wire).toEqual(["speed=0"]); // runs at once (queue idle)
    const s2 = enqueueStopLane(A, [rw("speed", 0)], laneExec(wire), projectExecutedForMember);
    const s3 = enqueueStopLane(A, [rw("run", 0)], laneExec(wire), projectExecutedForMember);
    expect([s1.joined, s2.joined, s3.joined]).toEqual([false, false, true]);
    expect(_adapterCommandQueueDepthForTests(A)).toBe(2);
    g1.resolve();
    await Promise.all([s1.result, s2.result, s3.result]);
    expect(wire).toEqual(["speed=0", "speed=0,run=0"]);
  });

  it("a STOP cancels the waiting ORDINARY commands (a stop-labelled one with arbitrary writes too) but never a PROTECTIVE interlock action, which keeps its place after the STOP", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rW = accepted(tryEnqueueAdapterCommand(A, job("W")));
    const rL = accepted(tryEnqueueAdapterCommand(A, job("L"), { protective: true }));
    const rX = accepted(tryEnqueueAdapterCommand(A, job("X-stop-labelled-arbitrary")));
    const wire: string[] = [];
    const s = enqueueStopLane(A, [rw("speed", 0)], async (u) => {
      log.push("STOP");
      return laneExec(wire)(u);
    }, projectExecutedForMember, { stopRef: { k: "S" } });
    expect(await rW).toEqual({ ...SUPERSEDED, stop: { k: "S" } });
    expect(await rX).toEqual({ ...SUPERSEDED, stop: { k: "S" } });
    ctl.get("A")!.resolve("a");
    await s.result;
    await flush();
    ctl.get("L")!.resolve("l");
    expect(await rL).toBe("l"); // protective: NOT cancelled
    expect(log).toEqual(["A", "STOP", "L"]);
  });

  it("R-11-h also on the legacy priorityStop path: a protective action is not cancelled", async () => {
    const { ctl, job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rL = accepted(tryEnqueueAdapterCommand(A, job("L"), { protective: true }));
    const rS = accepted(tryEnqueueAdapterCommand(A, job("S"), { priorityStop: true }));
    for (const n of ["A", "S", "L"]) {
      await flush();
      ctl.get(n)!.resolve(n);
    }
    expect(await rS).toBe("S");
    expect(await rL).toBe("L");
  });

  it("R-11-i (a): an ordinary command is capped (BUSY when full) — a protective one too; the lane never is", () => {
    const { job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    accepted(tryEnqueueAdapterCommand(A, job("B")));
    expect(tryEnqueueAdapterCommand(A, job("X")).accepted).toBe(false);
    expect(tryEnqueueAdapterCommand(A, job("L"), { protective: true }).accepted).toBe(false);
    const s = enqueueStopLane(A, [rw("speed", 0)], laneExec([]), projectExecutedForMember);
    expect(s.joined).toBe(false);
    expect(_adapterCommandQueueDepthForTests(A)).toBe(2); // B was cancelled, the group took one slot
  });

  it("joined STOP whose value for a tag differs from the group's (pin changed in between) ⇒ that tag is NOT sent and answers failed", async () => {
    const wire: string[] = [];
    const g = deferred<void>();
    enqueueStopLane(A, [rw("x", 1)], laneExec(wire, g.promise), projectExecutedForMember); // in flight
    const s1 = enqueueStopLane(A, [rw("speed", 0)], laneExec(wire), projectExecutedForMember);
    const s2 = enqueueStopLane(A, [rw("speed", 5), rw("run", 0)], laneExec(wire), projectExecutedForMember);
    g.resolve();
    const [, r2] = await Promise.all([s1.result, s2.result]);
    expect(wire[1]).toBe("speed=0,run=0");
    expect(r2.outcomes[0]).toMatchObject({ idx: 0, ok: false, status: "failed" });
    expect(r2.outcomes[1]).toMatchObject({ idx: 1, ok: true, status: "acked" });
  });

  it("tells the in-flight re-check listeners (pinned:false for a content stop, true otherwise)", () => {
    const seen: unknown[] = [];
    const off = onPinnedStopQueued(A, (ref, info) => seen.push({ ref, info }));
    const { job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    enqueueStopLane(A, [rw("speed", 0)], laneExec([]), projectExecutedForMember, { stopRef: { k: "C", contentStop: true } });
    enqueueStopLane(A, [rw("speed", 0)], laneExec([]), projectExecutedForMember, { stopRef: { k: "P" } });
    off();
    expect(seen).toEqual([
      { ref: { k: "C", contentStop: true }, info: { pinned: false } },
      { ref: { k: "P" }, info: { pinned: true } },
    ]);
  });
});

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

  it("who records it: an ordinary write (a stop-LABELLED one too) does; a TRUE stop and an INTERLOCK protective action do not", () => {
    expect(stopEpochAtGatesFor(base({}), { trueStop: false, epochAtGates: 7 })).toBe(7);
    expect(stopEpochAtGatesFor(base({ commandType: "stop" }), { trueStop: false, epochAtGates: 7 })).toBe(7);
    expect(stopEpochAtGatesFor(base({ commandType: "stop" }), { trueStop: true, epochAtGates: 7 })).toBeNull();
    expect(stopEpochAtGatesFor(base({ commandType: "stop_line", triggeredBy: { kind: "interlock", ruleId: 1, eventId: 1, approvedBy: 1 } }), { trueStop: false, epochAtGates: 7 })).toBeNull();
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
