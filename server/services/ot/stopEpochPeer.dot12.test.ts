/**
 * doc 81 Đợt 12 task P fix 1 — otDeviceWrite's PEER epoch (no DB):
 *   • I-2 (L-7): a peer move never supersedes a stop-typed command (verified or not); it cancels only non-STOP writes. A LOCAL STOP
 *     still supersedes an unverified stop (R-11-o M-3 unchanged).
 *   • I-3 (scan #111): the peer map is capped WITHOUT failing open — a new adapter always gets its entry; eviction raises a floor so
 *     an evicted adapter's epoch never moves back (a write in its gates before the eviction is still cancelled).
 *   • L-7 ordering against the real device stage: the broadcast is called only AFTER driver.writeTags was called.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { DispatchInput } from "./commandDispatcher";
import {
  adapterStopEpoch,
  bumpAdapterStopEpoch,
  bumpAdapterStopEpochFromPeer,
  executeOtDeviceWrite,
  executeOtDeviceWriteUnlessStopped,
  isStoppedBeforeWrite,
  setStopEpochBroadcaster,
  stopIssuedSince,
} from "./otDeviceWrite";

const base = (adapterId: number, over: Partial<DispatchInput>): DispatchInput => ({
  adapterId,
  commandType: "set",
  writes: [{ tagKey: "t", value: 1 }],
  triggeredBy: { kind: "hitl", requestedBy: 1 },
  idempotencyKey: "k",
  ...over,
});
function fakeDriver(log: string[]) {
  return {
    writeTags: async (w: Array<{ tagKey: string; value: unknown }>) => {
      for (const x of w) log.push(`writeTags ${x.tagKey}=${String(x.value)}`);
      return w.map((x) => ({ tagKey: x.tagKey, ok: true }));
    },
    readTags: async () => [],
  } as never;
}
const stage = (adapterId: number, log: string[], over: { commandType: string; value?: number; stopEpochAtGates: number | null; bumpStopEpoch?: boolean; overridesStopPin?: boolean }) => ({
  input: base(adapterId, { commandType: over.commandType, writes: [{ tagKey: "t", value: over.value ?? 1 }] }),
  driver: fakeDriver(log),
  resolved: [{ write: { tagKey: "t", value: over.value ?? 1 }, address: "40001", dataType: "int" }],
  driverWrites: [{ tagKey: "t", address: "40001", value: over.value ?? 1, dataType: "int" as never }],
  timeoutMs: 1000,
  stopTyped: over.commandType === "stop" || over.commandType === "e_stop",
  ledger: { intentIds: [], confirmedBy: 1 },
  sink: () => undefined,
  stopEpochAtGates: over.stopEpochAtGates,
  ...(over.bumpStopEpoch !== undefined ? { bumpStopEpoch: over.bumpStopEpoch } : {}),
  ...(over.overridesStopPin !== undefined ? { overridesStopPin: over.overridesStopPin } : {}),
});
afterEach(() => setStopEpochBroadcaster(null));

describe("I-2 (L-7) — a peer move never denies a STOP", () => {
  it("★ an UNVERIFIED stop-typed command in its gates when a PEER STOP arrives is still written", async () => {
    const A = 812_001;
    const log: string[] = [];
    const atGates = adapterStopEpoch(A);
    bumpAdapterStopEpochFromPeer(A, { peer: true, origin: "peer-replica-0001" });
    const r = await executeOtDeviceWriteUnlessStopped(stage(A, log, { commandType: "stop", value: 0, stopEpochAtGates: atGates, bumpStopEpoch: false, overridesStopPin: false }));
    expect(isStoppedBeforeWrite(r)).toBe(false);
    expect(log).toEqual(["writeTags t=0"]);
    const r2 = await executeOtDeviceWriteUnlessStopped(stage(A, log, { commandType: "e_stop", value: 0, stopEpochAtGates: atGates, bumpStopEpoch: false, overridesStopPin: false }));
    expect(isStoppedBeforeWrite(r2)).toBe(false);
  });

  it("★ scan 'authorization-logic' (fix 1 follow-up): a stop-LABELLED command that OVERRIDES a pinned stop value (re-energising) is NOT exempt — a peer STOP cancels it (classification by content, never by label — R-11-i / R-11-m)", async () => {
    const A = 812_005;
    const log: string[] = [];
    const atGates = adapterStopEpoch(A);
    bumpAdapterStopEpochFromPeer(A, { peer: true, origin: "peer-replica-0001" });
    const r = await executeOtDeviceWriteUnlessStopped(stage(A, log, { commandType: "stop", value: 77, stopEpochAtGates: atGates, bumpStopEpoch: false, overridesStopPin: true }));
    expect(r).toMatchObject({ stoppedBeforeWrite: true, stop: { peer: true } });
    expect(log).toEqual([]);
    // the same label without overriding a pin (the only STOP on an unpinned tag) stays exempt (I-2)
    const r2 = await executeOtDeviceWriteUnlessStopped(stage(A, log, { commandType: "stop", value: 0, stopEpochAtGates: atGates, bumpStopEpoch: false, overridesStopPin: false }));
    expect(isStoppedBeforeWrite(r2)).toBe(false);
    // a caller that does not say (overridesStopPin absent) gets no exemption: fail toward cancelling, never toward a label
    const r3 = await executeOtDeviceWriteUnlessStopped(stage(A, log, { commandType: "stop", value: 77, stopEpochAtGates: atGates, bumpStopEpoch: false }));
    expect(isStoppedBeforeWrite(r3)).toBe(true);
    expect(log).toEqual(["writeTags t=0"]);
  });

  it("the same peer STOP cancels a NON-STOP write in its gates (the point of the sync)", async () => {
    const A = 812_002;
    const log: string[] = [];
    const atGates = adapterStopEpoch(A);
    bumpAdapterStopEpochFromPeer(A, { peer: true, origin: "peer-replica-0001" });
    const r = await executeOtDeviceWriteUnlessStopped(stage(A, log, { commandType: "set", value: 7, stopEpochAtGates: atGates }));
    expect(r).toMatchObject({ stoppedBeforeWrite: true, stop: { peer: true } });
    expect(log).toEqual([]);
  });

  it("control: a LOCAL STOP still supersedes an unverified stop in its gates (R-11-o M-3), also after a peer move", async () => {
    const A = 812_003;
    const log: string[] = [];
    const atGates = adapterStopEpoch(A);
    bumpAdapterStopEpochFromPeer(A, { peer: true });
    bumpAdapterStopEpoch(A, { idempotencyKey: "LOCAL" });
    bumpAdapterStopEpochFromPeer(A, { peer: true }); // a later peer move does not hide the local one
    const r = await executeOtDeviceWriteUnlessStopped(stage(A, log, { commandType: "stop", value: 0, stopEpochAtGates: atGates, bumpStopEpoch: false, overridesStopPin: false }));
    expect(r).toMatchObject({ stoppedBeforeWrite: true, stop: { idempotencyKey: "LOCAL" } });
    expect(stopIssuedSince(A, atGates, { localOnly: true })?.stop).toEqual({ idempotencyKey: "LOCAL" });
  });

  it("control: a write whose gates begin AFTER the peer move is written", async () => {
    const A = 812_004;
    const log: string[] = [];
    bumpAdapterStopEpochFromPeer(A, { peer: true });
    const r = await executeOtDeviceWriteUnlessStopped(stage(A, log, { commandType: "set", value: 3, stopEpochAtGates: adapterStopEpoch(A) }));
    expect(isStoppedBeforeWrite(r)).toBe(false);
    expect(log).toEqual(["writeTags t=3"]);
  });
});

describe("I-3 (scan #111) — the peer cap never fails open", () => {
  it("★ a full peer map: a real peer STOP for a NEW adapter is applied; an evicted adapter's epoch never moves back; a write in its gates before the eviction is cancelled", async () => {
    vi.resetModules();
    const dw = await import("./otDeviceWrite");
    const MAX = dw.OT_STOP_EPOCH_PEER_ADAPTERS_MAX;
    const first = dw.bumpAdapterStopEpochFromPeer(1, { peer: true }).epoch;
    const atGatesOn2 = dw.adapterStopEpoch(2); // 0: adapter 2 never stopped
    for (let i = 2; i <= MAX; i++) dw.bumpAdapterStopEpochFromPeer(1_000_000 + i, { peer: true });
    const before1 = dw.adapterStopEpoch(1);
    expect(before1).toBe(first);
    // map full: a NEW adapter's peer STOP must land (not dropped)
    const NEW = 2_000_000_001;
    const b = dw.bumpAdapterStopEpochFromPeer(NEW, { peer: true, origin: "real-peer-0001" });
    expect(b.evicted).toBe(1);
    expect(dw.adapterStopEpoch(NEW)).toBe(b.epoch);
    // the evicted adapter reads the floor: never below what it had
    expect(dw.adapterStopEpoch(1)).toBeGreaterThanOrEqual(before1);
    // adapters without an entry read the floor too — a write in gates since before the eviction is cancelled (safe direction)
    expect(dw.stopIssuedSince(2, atGatesOn2)).toMatchObject({ stoppedBeforeWrite: true });
    // a stop-typed command is still never denied by peers (I-2)
    expect(dw.stopIssuedSince(2, atGatesOn2, { localOnly: true })).toBeNull();
    expect(dw.peerStopEpochStats().size).toBe(MAX);
  });
});

describe("L-7 — the broadcast follows the REAL device write", () => {
  it("★ executeOtDeviceWrite of a true STOP: driver.writeTags is called first, the broadcaster only afterwards (never inside the STOP's path)", async () => {
    const A = 812_010;
    const log: string[] = [];
    setStopEpochBroadcaster((m) => void log.push(`broadcast adapter ${m.adapterId}`));
    const p = executeOtDeviceWrite(stage(A, log, { commandType: "stop", value: 0, stopEpochAtGates: null, bumpStopEpoch: true }));
    expect(log).toEqual(["writeTags t=0"]); // synchronously: the write was called, nothing broadcast yet
    await p;
    await new Promise<void>((r) => setImmediate(r));
    expect(log).toEqual(["writeTags t=0", `broadcast adapter ${A}`]);
  });
});
