/**
 * doc 81 Đợt 11 K-fix — PURE checks of the two rulings (no DB, no real driver):
 *   R-11-c (D-1, L-7): an UNPINNED stop-typed command in the per-adapter queue is never BUSY, cancels the non-stop commands
 *     WAITING, keeps the waiting stops, stands right after them (waits only for the one in flight); a later PINNED stop still
 *     cancels it (R-1E-b unchanged).
 *   R-11-d: the per-adapter STOP epoch — which commands record it (stopEpochAtGatesFor), the check right before the device write
 *     (executeOtDeviceWriteUnlessStopped), and the bump of a STOP sent straight through the device stage (central fallback / sweep).
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
import { adapterStopEpoch, bumpAdapterStopEpoch, executeOtDeviceWrite, executeOtDeviceWriteUnlessStopped, isStoppedBeforeWrite, onPinnedStopQueued } from "./otDeviceWrite";

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

describe("R-11-c — an UNPINNED stop-typed command in the per-adapter queue", () => {
  const A = 5151;

  it("full queue ⇒ still accepted (never BUSY); the waiting writes are cancelled naming it; it runs right after the in-flight one", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(A, job("A"))); // in flight
    const rB = accepted(tryEnqueueAdapterCommand(A, job("B"))); // waiting ⇒ depth 2 = max
    expect(tryEnqueueAdapterCommand(A, job("X")).accepted).toBe(false); // control: a write IS BUSY
    const ref = { idempotencyKey: "S-u", pinned: false };
    const rS = accepted(tryEnqueueAdapterCommand(A, job("S"), { stopTyped: true, stopRef: ref }));
    expect(await rB).toEqual({ ...SUPERSEDED, stop: ref });
    await flush();
    expect(log).toEqual(["A"]);
    ctl.get("A")!.resolve("a");
    expect(await rA).toBe("a");
    await flush();
    expect(log).toEqual(["A", "S"]);
    ctl.get("S")!.resolve("s");
    expect(await rS).toBe("s");
  });

  it("does NOT cancel a waiting stop (pinned or not) and stands after it, ahead of every write queued before it", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rP = accepted(tryEnqueueAdapterCommand(A, job("P"), { priorityStop: true }));
    const rU1 = accepted(tryEnqueueAdapterCommand(A, job("U1"), { stopTyped: true }));
    const rW = accepted(tryEnqueueAdapterCommand(A, job("W")));
    const rU2 = accepted(tryEnqueueAdapterCommand(A, job("U2"), { stopTyped: true }));
    expect(await rW).toEqual(SUPERSEDED); // the write waiting ahead of U2 is cancelled
    for (const n of ["A", "P", "U1", "U2"]) {
      await flush();
      ctl.get(n)!.resolve(n);
    }
    await Promise.all([rP, rU1, rU2]);
    expect(log).toEqual(["A", "P", "U1", "U2"]);
  });

  it("a write queued AFTER the unpinned stop waits behind it (FIFO, not cancelled)", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rS = accepted(tryEnqueueAdapterCommand(A, job("S"), { stopTyped: true }));
    const rD = accepted(tryEnqueueAdapterCommand(A, job("D")));
    for (const n of ["A", "S", "D"]) {
      await flush();
      ctl.get(n)!.resolve(n);
    }
    expect(await rS).toBe("S");
    expect(await rD).toBe("D");
    expect(log).toEqual(["A", "S", "D"]);
  });

  it("R-1E-b unchanged: a later PINNED stop cancels a waiting UNPINNED stop", async () => {
    const { job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rU = accepted(tryEnqueueAdapterCommand(A, job("U"), { stopTyped: true }));
    accepted(tryEnqueueAdapterCommand(A, job("P"), { priorityStop: true, stopRef: { k: "P" } }));
    expect(await rU).toEqual({ ...SUPERSEDED, stop: { k: "P" } });
  });

  it("tells the in-flight re-check listeners, marked pinned:false (a pinned stop says pinned:true)", () => {
    const seen: Array<unknown> = [];
    const off = onPinnedStopQueued(A, (ref, info) => seen.push({ ref, info }));
    const { job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    accepted(tryEnqueueAdapterCommand(A, job("U"), { stopTyped: true, stopRef: { k: "U" } }));
    accepted(tryEnqueueAdapterCommand(A, job("P"), { priorityStop: true, stopRef: { k: "P" } }));
    off();
    expect(seen).toEqual([
      { ref: { k: "U" }, info: { pinned: false } },
      { ref: { k: "P" }, info: { pinned: true } },
    ]);
    expect(_adapterCommandQueueDepthForTests(A)).toBe(2);
  });
});

describe("R-11-d — the per-adapter STOP epoch", () => {
  const A = 6161;
  const base = (over: Partial<DispatchInput>): DispatchInput => ({
    adapterId: A,
    commandType: "set",
    writes: [{ tagKey: "t", value: 1 }],
    triggeredBy: { kind: "hitl", requestedBy: 1 },
    idempotencyKey: "k",
    ...over,
  });

  it("which commands record it: a non-STOP hitl write does; a stop-typed command and an INTERLOCK safety action do not", () => {
    const e = bumpAdapterStopEpoch(A);
    expect(stopEpochAtGatesFor(base({}))).toBe(e);
    expect(stopEpochAtGatesFor(base({ commandType: "stop" }))).toBeNull();
    expect(stopEpochAtGatesFor(base({ commandType: "E_STOP" }))).toBeNull();
    expect(stopEpochAtGatesFor(base({ commandType: "stop_line", triggeredBy: { kind: "interlock", ruleId: 1, eventId: 1, approvedBy: 1 } }))).toBeNull();
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
  const stage = (driver: never, over: { stopTyped: boolean; commandType?: string; value?: number; stopEpochAtGates: number | null; stopEpochBumped?: boolean }) => ({
    input: base({ commandType: over.commandType ?? (over.stopTyped ? "stop" : "set"), writes: [{ tagKey: "t", value: over.value ?? 1 }] }),
    driver,
    resolved: [{ write: { tagKey: "t", value: over.value ?? 1 }, address: "40001", dataType: "int" }],
    driverWrites: [{ tagKey: "t", address: "40001", value: over.value ?? 1, dataType: "int" as never }],
    timeoutMs: 1000,
    stopTyped: over.stopTyped,
    ledger: { intentIds: [], confirmedBy: 1 },
    stopEpochAtGates: over.stopEpochAtGates,
    ...(over.stopEpochBumped !== undefined ? { stopEpochBumped: over.stopEpochBumped } : {}),
  });

  it("a non-STOP write whose epoch moved is cancelled: nothing reaches the driver, the STOP is named", async () => {
    const { driver, writes } = fakeDriver();
    const atGates = adapterStopEpoch(A);
    const now = bumpAdapterStopEpoch(A, { idempotencyKey: "S1" });
    const r = await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: false, stopEpochAtGates: atGates }));
    expect(isStoppedBeforeWrite(r)).toBe(true);
    expect(r).toEqual({ stoppedBeforeWrite: true, epochAtGates: atGates, epochNow: now, stop: { idempotencyKey: "S1" } });
    expect(writes).toEqual([]);
  });

  it("controls: unchanged epoch ⇒ written; stop-typed ⇒ never cancelled; null epoch (interlock) ⇒ never cancelled", async () => {
    const { driver, writes } = fakeDriver();
    const r1 = await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: false, stopEpochAtGates: adapterStopEpoch(A), value: 1 }));
    expect(isStoppedBeforeWrite(r1)).toBe(false);
    const old = adapterStopEpoch(A);
    bumpAdapterStopEpoch(A);
    const r2 = await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: true, stopEpochAtGates: old, value: 2, stopEpochBumped: true }));
    expect(isStoppedBeforeWrite(r2)).toBe(false);
    const r3 = await executeOtDeviceWriteUnlessStopped(stage(driver, { stopTyped: false, commandType: "stop_line", stopEpochAtGates: null, value: 3 }));
    expect(isStoppedBeforeWrite(r3)).toBe(false);
    expect(writes).toEqual(["t=1", "t=2", "t=3"]);
  });

  it("a STOP sent straight through the device stage (central fallback / sweep: no stopEpochBumped) bumps the epoch; a caller-bumped one does not bump again", async () => {
    const { driver } = fakeDriver();
    const e0 = adapterStopEpoch(A);
    await executeOtDeviceWrite(stage(driver, { stopTyped: true, stopEpochAtGates: null }));
    const e1 = adapterStopEpoch(A);
    expect(e1).toBeGreaterThan(e0);
    await executeOtDeviceWrite(stage(driver, { stopTyped: true, stopEpochAtGates: null, stopEpochBumped: true }));
    expect(adapterStopEpoch(A)).toBe(e1);
    await executeOtDeviceWrite(stage(driver, { stopTyped: false, stopEpochAtGates: null }));
    expect(adapterStopEpoch(A)).toBe(e1); // a non-STOP never bumps
  });
});
