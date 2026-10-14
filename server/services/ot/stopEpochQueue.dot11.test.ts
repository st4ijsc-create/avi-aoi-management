/**
 * doc 81 Đợt 11 K-fix / K-fix 2 — PURE checks (no DB, no real driver) of the queue and the STOP epoch:
 *   R-11-i (c) the BOUNDED stop lane (enqueueStopLane): per adapter one STOP in flight + ONE waiting group; more STOPs JOIN the
 *     waiting group (no queue entry, no extra device write); members' results resolve together, projected on their own writes;
 *   R-11-h a PROTECTIVE interlock action is never cancelled by a STOP (lane or legacy priorityStop) and keeps its place;
 *   R-11-i (a) ordinary commands (a stop-LABELLED one with arbitrary writes too) are capped (BUSY when full) and cancelled by a STOP;
 *   R-11-d / R-11-i (b) the STOP epoch: who records it (stopEpochAtGatesFor), the check right before the device write, and the bump
 *     only when a TRUE stop is SENT (executeOtDeviceWrite bumpStopEpoch).
 * doc 81 Đợt 11 final fix wave (rulings R-11-j + addendum, R-11-k) — the lane block is rewritten: EVERY stop (pinned / verified by
 *   content / unverified stop-typed) takes the lane; stops coalesce only when their device writes are IDENTICAL; a pinned STOP stands
 *   ahead of every other stop; waiting unverified groups are capped (newest replaces oldest); each member gets the true outcome of
 *   the one write that contained exactly its writes; the group gets every member's intents and the strictest timeout; a verified stop
 *   cancels a protective action only when that action would override a pinned stop value.
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
  _adapterQueueLineForTests,
  applyPinsAtSend,
  OT_STOP_LANE_UNVERIFIED_MAX,
  type ExecutedWrite,
  type OtResolvedWrite,
  type StopLaneGroupCtx,
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

describe("R-11-k (1)(2) — the STOP lane: every stop, identical writes only, pinned first, bounded", () => {
  const A = 5151;

  it("★ STOP FLOOD of IDENTICAL pinned STOPs while a write is in flight ⇒ ONE waiting group (depth ≤ 2), ONE device write, all 50 resolve with that write's outcome", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(A, job("A"))); // in flight
    const wire: string[] = [];
    const results: Array<Promise<unknown>> = [];
    let joined = 0;
    for (let i = 0; i < 50; i++) {
      const r = enqueueStopLane(A, [rw("run", 0), rw("speed", 0)], laneExec(wire), projectExecutedForMember, { cls: "pinned", stopRef: { k: `S${i}` } });
      if (r.joined) joined++;
      results.push(r.result);
      expect(_adapterCommandQueueDepthForTests(A)).toBeLessThanOrEqual(2);
    }
    expect(joined).toBe(49);
    expect(_stopLaneWaitingMembersForTests(A)).toBe(50);
    ctl.get("A")!.resolve("a");
    expect(await rA).toBe("a");
    const all = (await Promise.all(results)) as ExecutedWrite[];
    expect(wire).toEqual(["run=0,speed=0"]); // ONE device write
    expect(log).toEqual(["A"]);
    for (const r of all) expect(r.outcomes.map((o) => [o.idx, o.ok, o.status])).toEqual([[0, true, "acked"], [1, true, "acked"]]);
    await flush();
    expect(_adapterCommandQueueDepthForTests(A)).toBe(0);
  });

  it("★ a stop JOINING a waiting group is a newer stop intent: an ordinary write queued AFTER the group (and before the joiner) is cancelled", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const g1 = enqueueStopLane(A, [rw("speed", 0)], laneExec([]), projectExecutedForMember, { cls: "pinned", stopRef: { k: "P1" } });
    const rW = accepted(tryEnqueueAdapterCommand(A, job("W"))); // issued after P1, before P2
    const g2 = enqueueStopLane(A, [rw("speed", 0)], laneExec([]), projectExecutedForMember, { cls: "pinned", stopRef: { k: "P2" } });
    expect(g2.joined).toBe(true);
    expect(await rW).toEqual({ ...SUPERSEDED, stop: { k: "P2" } });
    ctl.get("A")!.resolve("a");
    await Promise.all([g1.result, g2.result]);
    expect(log).toEqual(["A"]);
  });

  it("★ R-11-m: at the group's turn, a member whose epoch moved (a verified STOP was SENT after its gates began) is superseded; others in the group are written; all superseded ⇒ no device write", async () => {
    const { ctl, job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const wire: string[] = [];
    const e0 = adapterStopEpoch(A);
    const u1 = enqueueStopLane(A, [rw("run", 1)], laneExec(wire), projectExecutedForMember, { cls: "unverified", member: { stopEpochAtGates: e0 } });
    const u2 = enqueueStopLane(A, [rw("run", 1)], laneExec(wire), projectExecutedForMember, { cls: "unverified", member: { stopEpochAtGates: null } });
    const u3 = enqueueStopLane(A, [rw("jog", 1)], laneExec(wire), projectExecutedForMember, { cls: "unverified", member: { stopEpochAtGates: e0 } });
    bumpAdapterStopEpoch(A, { idempotencyKey: "P" }); // the verified STOP is SENT (e.g. central's fallback) while they wait
    ctl.get("A")!.resolve("a");
    expect(await u1.result).toEqual({ ...SUPERSEDED, stop: { idempotencyKey: "P" } });
    expect((await u2.result) as ExecutedWrite).toMatchObject({ outcomes: [{ ok: true, status: "acked" }] });
    expect(await u3.result).toEqual({ ...SUPERSEDED, stop: { idempotencyKey: "P" } });
    expect(wire).toEqual(["run=1"]); // u3's group wrote nothing
    await flush();
    expect(_adapterCommandQueueDepthForTests(A)).toBe(0);
  });

  it("★ C-1/I-2: stops with DIFFERENT device writes never coalesce — each gets its own write and that write's TRUE outcome (a failed write ⇒ failed)", async () => {
    const { ctl, job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const wire: string[] = [];
    // the device refuses the `run` write; `speed` is accepted
    const exec = async (writes: OtResolvedWrite[]): Promise<ExecutedWrite> => {
      wire.push(writes.map((u) => `${u.write.tagKey}=${String(u.write.value)}`).join(","));
      return { sentAt: new Date(0), timedOut: false, outcomes: writes.map((u, idx) => ({ idx, ok: u.write.tagKey !== "run", status: u.write.tagKey !== "run" ? ("acked" as const) : ("failed" as const), errorText: u.write.tagKey !== "run" ? null : "device refused", readBackValue: null })) };
    };
    const s1 = enqueueStopLane(A, [rw("speed", 0)], exec, projectExecutedForMember, { cls: "pinned" });
    const s2 = enqueueStopLane(A, [rw("speed", 0), rw("run", 0)], exec, projectExecutedForMember, { cls: "pinned" });
    const s3 = enqueueStopLane(A, [rw("speed", 0)], exec, projectExecutedForMember, { cls: "pinned", connKey: null }); // = s1's key ⇒ joins s1
    const s4 = enqueueStopLane(A, [{ ...rw("speed", 0), address: "other" }], exec, projectExecutedForMember, { cls: "pinned" }); // other address
    const s5 = enqueueStopLane(A, [{ ...rw("speed", 0), scale: 10 }], exec, projectExecutedForMember, { cls: "pinned" }); // other scale
    const s6 = enqueueStopLane(A, [rw("run", 0), rw("speed", 0)], exec, projectExecutedForMember, { cls: "pinned" }); // = s2's writes, other order ⇒ joins s2
    const s7 = enqueueStopLane(A, [rw("speed", 0)], exec, projectExecutedForMember, { cls: "pinned", connKey: "another-connection" }); // other running connection
    const s8 = enqueueStopLane(A, [rw("speed", 0)], exec, projectExecutedForMember, { cls: "verified" }); // same writes, other class: never joins the pinned group
    expect([s1.joined, s2.joined, s3.joined, s4.joined, s5.joined, s6.joined, s7.joined, s8.joined]).toEqual([false, false, true, false, false, true, false, false]);
    expect(_adapterQueueLineForTests(A).map((x) => x.cls)).toEqual(["pinned", "pinned", "pinned", "pinned", "pinned", "verified"]); // the verified group behind every pinned one
    ctl.get("A")!.resolve("a");
    const [r1, r2, r3, , , r6] = (await Promise.all([s1.result, s2.result, s3.result, s4.result, s5.result, s6.result, s7.result, s8.result])) as ExecutedWrite[];
    expect(wire).toEqual(["speed=0", "speed=0,run=0", "speed=0", "speed=0", "speed=0", "speed=0"]);
    expect(r6.outcomes.map((o) => [o.idx, o.ok, o.status])).toEqual([[0, false, "failed"], [1, true, "acked"]]); // ITS run (idx 0) failed, ITS speed acked
    expect(r1.outcomes).toEqual([{ idx: 0, ok: true, status: "acked", errorText: null, readBackValue: null }]);
    expect(r3.outcomes).toEqual(r1.outcomes);
    expect(r2.outcomes.map((o) => [o.idx, o.ok, o.status])).toEqual([[0, true, "acked"], [1, false, "failed"]]); // its own write's truth
  });

  it("★ C-1 scenario 2: a pin changed between two STOPs ⇒ two groups, BOTH values written in order (no 'conflict' drop) — the newest pin is the last word", async () => {
    const { ctl, job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const wire: string[] = [];
    const p1 = enqueueStopLane(A, [rw("speed", 0)], laneExec(wire), projectExecutedForMember, { cls: "pinned" });
    const p2 = enqueueStopLane(A, [rw("speed", 5)], laneExec(wire), projectExecutedForMember, { cls: "pinned" });
    ctl.get("A")!.resolve("a");
    const [r1, r2] = (await Promise.all([p1.result, p2.result])) as ExecutedWrite[];
    expect(wire).toEqual(["speed=0", "speed=5"]);
    expect(r1.outcomes[0]).toMatchObject({ ok: true, status: "acked" });
    expect(r2.outcomes[0]).toMatchObject({ ok: true, status: "acked" });
  });

  it("★ line order: an unverified stop stands behind the waiting pinned / verified stops and ahead of every ordinary entry; a pinned stop goes ahead of a waiting verified one", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rL = accepted(tryEnqueueAdapterCommand(A, job("L"), { protective: true }));
    const order: string[] = [];
    const named = (n: string) => async (writes: OtResolvedWrite[]) => {
      order.push(n);
      return laneExec([])(writes);
    };
    const c = enqueueStopLane(A, [rw("run", 0)], named("C"), projectExecutedForMember, { cls: "verified" });
    const p = enqueueStopLane(A, [rw("speed", 0)], named("P"), projectExecutedForMember, { cls: "pinned" });
    const u = enqueueStopLane(A, [rw("x", 1)], named("U"), projectExecutedForMember, { cls: "unverified" });
    expect(_adapterQueueLineForTests(A).map((x) => x.cls)).toEqual(["pinned", "verified", "unverified", "protective"]);
    ctl.get("A")!.resolve("a");
    await Promise.all([u.result, c.result, p.result]);
    await flush();
    ctl.get("L")!.resolve("l");
    expect(await rL).toBe("l");
    expect(order).toEqual(["P", "C", "U"]);
    expect(log).toEqual(["A", "L"]);
  });

  it("★ C-2 bound: WAITING unverified groups are capped — the newest replaces the oldest (Superseded naming the newer stop), never BUSY even on a full queue; verified groups are never replaced", async () => {
    const { ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "1";
    accepted(tryEnqueueAdapterCommand(A, job("A"))); // the queue is FULL
    expect(OT_STOP_LANE_UNVERIFIED_MAX).toBe(2);
    const wire: string[] = [];
    const p = enqueueStopLane(A, [rw("speed", 0)], laneExec(wire), projectExecutedForMember, { cls: "pinned" });
    const u1 = enqueueStopLane(A, [rw("x", 1)], laneExec(wire), projectExecutedForMember, { cls: "unverified", stopRef: { k: "U1" } });
    const u2 = enqueueStopLane(A, [rw("x", 2)], laneExec(wire), projectExecutedForMember, { cls: "unverified", stopRef: { k: "U2" } });
    const u2b = enqueueStopLane(A, [rw("x", 2)], laneExec(wire), projectExecutedForMember, { cls: "unverified", stopRef: { k: "U2b" } }); // identical ⇒ joins
    const u3 = enqueueStopLane(A, [rw("x", 3)], laneExec(wire), projectExecutedForMember, { cls: "unverified", stopRef: { k: "U3" } });
    expect(u2b.joined).toBe(true);
    expect(await u1.result).toEqual({ ...SUPERSEDED, stop: { k: "U3" } }); // the oldest waiting unverified group
    expect(_adapterQueueLineForTests(A)).toEqual([{ cls: "pinned", members: 1 }, { cls: "unverified", members: 2 }, { cls: "unverified", members: 1 }]);
    expect(_adapterCommandQueueDepthForTests(A)).toBe(4); // A + P + two unverified groups
    ctl.get("A")!.resolve("a");
    await Promise.all([u2.result, u2b.result, p.result, u3.result]);
    expect(wire).toEqual(["speed=0", "x=2", "x=3"]);
  });

  it("★ R-1E-b (kept): a VERIFIED stop cancels a WAITING unverified stop (its unproven values must not run after the STOP and undo it); an unverified stop never cancels a verified one", async () => {
    const { ctl, job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const wire: string[] = [];
    const u = enqueueStopLane(A, [rw("cmd_stop", false)], laneExec(wire), projectExecutedForMember, { cls: "unverified", stopRef: { k: "U" } });
    const c = enqueueStopLane(A, [rw("run", 0)], laneExec(wire), projectExecutedForMember, { cls: "verified", stopRef: { k: "C", contentStop: true } });
    expect(await u.result).toEqual({ ...SUPERSEDED, stop: { k: "C", contentStop: true } });
    const u2 = enqueueStopLane(A, [rw("cmd_stop", false)], laneExec(wire), projectExecutedForMember, { cls: "unverified", stopRef: { k: "U2" } });
    ctl.get("A")!.resolve("a");
    await Promise.all([c.result, u2.result]);
    expect(wire).toEqual(["run=0", "cmd_stop=false"]); // the verified stop first; the later unverified one after it (it cancelled nothing)
  });

  it("★ R-11-j: an UNVERIFIED stop cancels the waiting ORDINARY writes only — never a protective interlock action (even one overriding a pin) — and tells no re-check listener", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    const seen: unknown[] = [];
    const off = onPinnedStopQueued(A, (ref) => seen.push(ref));
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rW = accepted(tryEnqueueAdapterCommand(A, job("W")));
    const rL = accepted(tryEnqueueAdapterCommand(A, job("L"), { protective: true, overridesStopPin: true }));
    const u = enqueueStopLane(A, [rw("x", 1)], laneExec([]), projectExecutedForMember, { cls: "unverified", stopRef: { k: "U" } });
    off();
    expect(await rW).toEqual({ ...SUPERSEDED, stop: { k: "U" } });
    expect(seen).toEqual([]);
    ctl.get("A")!.resolve("a");
    await u.result;
    await flush();
    ctl.get("L")!.resolve("l");
    expect(await rL).toBe("l");
    expect(log).toEqual(["A", "L"]);
  });

  it("★ R-11-k (3): a VERIFIED stop cancels a waiting protective action that writes a pinned stop tag with a non-pin value; it keeps one that does not", async () => {
    const { log, ctl, job } = makeJobs();
    process.env.OT_CMD_QUEUE_MAX = "10";
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const rReduce = accepted(tryEnqueueAdapterCommand(A, job("reduce_speed=30"), { protective: true, overridesStopPin: true }));
    const rBlock = accepted(tryEnqueueAdapterCommand(A, job("block"), { protective: true }));
    const p = enqueueStopLane(A, [rw("speed", 0)], laneExec([]), projectExecutedForMember, { cls: "pinned", stopRef: { k: "P" } });
    expect(await rReduce).toEqual({ ...SUPERSEDED, stop: { k: "P" } });
    ctl.get("A")!.resolve("a");
    await p.result;
    await flush();
    ctl.get("block")!.resolve("b");
    expect(await rBlock).toBe("b");
    expect(log).toEqual(["A", "block"]);
  });

  it("the legacy priorityStop path follows R-11-k (3) too: protective kept unless it overrides a pin", async () => {
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

  it("an ordinary command is capped (BUSY when full) — a protective one too; the lane never is", () => {
    const { job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    accepted(tryEnqueueAdapterCommand(A, job("B")));
    expect(tryEnqueueAdapterCommand(A, job("X")).accepted).toBe(false);
    expect(tryEnqueueAdapterCommand(A, job("L"), { protective: true }).accepted).toBe(false);
    const s = enqueueStopLane(A, [rw("speed", 0)], laneExec([]), projectExecutedForMember, { cls: "unverified" });
    expect(s.joined).toBe(false);
    expect(_adapterCommandQueueDepthForTests(A)).toBe(2); // B was cancelled, the group took one slot
  });

  it("★ C-1 (3): the group runs with EVERY member's intents and the strictest timeout", async () => {
    const { ctl, job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    const seen: StopLaneGroupCtx[] = [];
    const exec = async (writes: OtResolvedWrite[], g: StopLaneGroupCtx) => {
      seen.push(g);
      return laneExec([])(writes);
    };
    const m1 = enqueueStopLane(A, [rw("speed", 0)], exec, projectExecutedForMember, { cls: "pinned", member: { intentIds: [11, 12], timeoutMs: 5000 } });
    const m2 = enqueueStopLane(A, [rw("speed", 0)], exec, projectExecutedForMember, { cls: "pinned", member: { intentIds: [21], timeoutMs: 1500 } });
    const m3 = enqueueStopLane(A, [rw("speed", 0)], exec, projectExecutedForMember, { cls: "pinned", member: { intentIds: [31] } });
    ctl.get("A")!.resolve("a");
    await Promise.all([m1.result, m2.result, m3.result]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ cls: "pinned", intentIds: [11, 12, 21, 31], timeoutMs: 1500, members: 3 });
    expect(typeof seen[0].dropStopped).toBe("function");
  });

  it("tells the in-flight re-check listeners about VERIFIED stops only (pinned:false for a content stop, true for the pin)", () => {
    const seen: unknown[] = [];
    const off = onPinnedStopQueued(A, (ref, info) => seen.push({ ref, info }));
    const { job } = makeJobs();
    accepted(tryEnqueueAdapterCommand(A, job("A")));
    enqueueStopLane(A, [rw("speed", 0)], laneExec([]), projectExecutedForMember, { cls: "verified", stopRef: { k: "C", contentStop: true } });
    enqueueStopLane(A, [rw("run", 0)], laneExec([]), projectExecutedForMember, { cls: "pinned", stopRef: { k: "P" } });
    enqueueStopLane(A, [rw("x", 1)], laneExec([]), projectExecutedForMember, { cls: "unverified", stopRef: { k: "U" } });
    off();
    expect(seen).toEqual([
      { ref: { k: "C", contentStop: true }, info: { pinned: false } },
      { ref: { k: "P" }, info: { pinned: true } },
    ]);
  });

  it("R-11-k (2) applyPinsAtSend: a changed pin is sent (and reported); a gone pin / a pin that no longer fits / unreadable pins keep the classified value", () => {
    const fits = (dt: string | undefined, v: unknown) => dt === "int" && typeof v === "number";
    const w = [rw("speed", 0), rw("run", 0), rw("jog", 0)];
    const r = applyPinsAtSend(w, [{ tagKey: "speed", value: 2 }, { tagKey: "run", value: "x" }], fits);
    expect(r.writes.map((x) => x.write.value)).toEqual([2, 0, 0]);
    expect(r.changed).toEqual([{ tagKey: "speed", requested: 0, sent: 2 }]);
    expect(applyPinsAtSend(w, null, fits)).toEqual({ writes: w, changed: [] });
    expect(applyPinsAtSend(w, [{ tagKey: "speed", value: 0 }], fits).changed).toEqual([]);
  });

  it("projection: a member's pinAtSend note is carried for its own tags only; a non-executed result is shared as is", () => {
    const ex: ExecutedWrite = { sentAt: new Date(0), timedOut: false, outcomes: [{ idx: 0, ok: true, status: "acked", errorText: null, readBackValue: null }], pinAtSend: [{ tagKey: "speed", requested: 0, sent: 2 }] };
    const p = projectExecutedForMember(ex, [rw("speed", 2)], [rw("speed", 0)]) as ExecutedWrite;
    expect(p.pinAtSend).toEqual([{ tagKey: "speed", requested: 0, sent: 2 }]);
    expect(projectExecutedForMember(ex, [rw("run", 0)], [rw("run", 0)]).pinAtSend).toBeUndefined();
    const other = { safetyRecheckRefused: true };
    expect(projectExecutedForMember(other as never, [rw("x", 1)], [rw("x", 1)])).toBe(other);
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
