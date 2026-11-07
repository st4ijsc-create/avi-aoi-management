/**
 * Đĩa edge treo (a2n) — the JOURNAL half. Real journal, real files, a hand on the io (edgeDiskStall.testkit):
 *   • stalledSince(): the age of the write / fsync now in the chain, for `write`, `sync`, and the `writeFileAtomic` of roll and compact; null when none;
 *   • an fsync past its bound (fsyncOverrun): non-STOP stays CLOSED until a restart, exactly as ioFailed did — but it is not an IO error: a disk that
 *     returns takes the queued records, so the run can report and end instead of sticking in `running`;
 *   • a real IO error stays ioFailed: nothing more is written;
 *   • a restart opens the journal again; a jti consumed before stays consumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { choDen, diskGia, nghi, thuMucTam } from "./edgeDiskStall.testkit";
import { EdgeJournal } from "./edgeJournal";

const tam = thuMucTam();
const mo: EdgeJournal[] = [];
const dias: Array<ReturnType<typeof diskGia>> = [];
const J = { jti: "jti-a", runId: 9, claimSeq: 1, stepId: "m1", attempt: 1 };
const ev = (detail = "x") => ({ kind: "anomaly" as const, code: "T", runId: null, detail, at: 1 });
const robot = { robotId: 2, ts: 1, busy: false };

async function moJournal(over: Record<string, unknown> = {}) {
  const dia = diskGia();
  dias.push(dia);
  const j = await EdgeJournal.open({ dir: await tam.mk(), io: dia.io, groupCommitMs: 0, authSyncTimeoutMs: 30, stopBoundMs: 30, log: () => undefined, ...over });
  mo.push(j);
  return { j, dia };
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of dias.splice(0)) d.tha(); // a test that failed mid-hang must not leave close() waiting on it
  for (const j of mo.splice(0)) await j.close().catch(() => undefined);
  await tam.don();
});

describe("a2n stalledSince — the age of the write / fsync now running", () => {
  it("★ set from the moment a hung fsync started, null again once it returned", async () => {
    let t = 1_000;
    const { j, dia } = await moJournal({ now: () => t });
    expect(j.stalledSince()).toBeNull();
    dia.treoSync();
    t = 2_000;
    const f = j.flush();
    await choDen(() => dia.dem.sync > 0, "fsync started");
    t = 9_000;
    expect(j.stalledSince()).toBe(2_000); // the start, not the moment of asking
    dia.tha();
    await f;
    expect(j.stalledSince()).toBeNull();
  });

  it("★ a hung WRITE shows the same age: an appended record never reached its fsync", async () => {
    let t = 1_000;
    const { j, dia } = await moJournal({ now: () => t });
    dia.treoWrite();
    t = 3_000;
    const p = j.appendEvent(ev());
    await choDen(() => dia.dem.write > 0, "write started");
    t = 8_000;
    expect(j.stalledSince()).toBe(3_000);
    expect(dia.dem.sync).toBe(0);
    dia.tha();
    await p;
    expect(j.stalledSince()).toBeNull();
  });

  it("★ the writeFileAtomic of a segment ROLL shows it too: every record behind it waits on it", async () => {
    let t = 1_000;
    const { j, dia } = await moJournal({ now: () => t, segmentMaxBytes: 100 });
    const n = dia.dem.atomic; // the open wrote files too
    dia.treoAtomic();
    t = 4_000;
    const p = j.appendEvent(ev("y".repeat(200)));
    await choDen(() => dia.dem.atomic > n, "roll reached writeFileAtomic");
    t = 9_500;
    expect(j.stalledSince()).toBe(4_000);
    dia.tha();
    await p;
    expect(j.stalledSince()).toBeNull();
  });

  it("★ the writeFileAtomic of COMPACT shows it too", async () => {
    let t = 1_000;
    const { j, dia } = await moJournal({ now: () => t });
    const n = dia.dem.atomic; // the open wrote files too
    dia.treoAtomic();
    t = 5_000;
    const p = j.compact();
    await choDen(() => dia.dem.atomic > n, "compact reached writeFileAtomic");
    t = 11_000;
    expect(j.stalledSince()).toBe(5_000);
    dia.tha();
    await p;
    expect(j.stalledSince()).toBeNull();
  });

  it.each(["sync", "close", "open"] as const)("★ every call of a segment roll shows its age: %s", async (op) => {
    let t = 1_000;
    const { j, dia } = await moJournal({ now: () => t, segmentMaxBytes: 100 });
    const n = { ...dia.dem };
    if (op === "sync") dia.treoSync();
    else dia.treoOp(op);
    t = 4_000;
    const p = j.appendEvent(ev("y".repeat(200)));
    await choDen(() => dia.dem[op] > n[op], `roll reached ${op}`);
    t = 9_500;
    expect(j.stalledSince()).toBe(4_000);
    dia.tha();
    await p;
    await j.flush();
    expect(j.stalledSince()).toBeNull();
  });

  it("★ the unlink of COMPACT shows its age too", async () => {
    let t = 1_000;
    const { j, dia } = await moJournal({ now: () => t, segmentMaxBytes: 100 });
    await j.appendEvent(ev("y".repeat(200))); // rolls: the first segment holds only this record
    await j.flush();
    dia.treoOp("unlink");
    t = 6_000;
    j.ack("events", 1); // central took it: that segment can go
    await choDen(() => dia.dem.unlink > 0, "compact reached unlink");
    t = 12_000;
    expect(j.stalledSince()).toBe(6_000);
    dia.tha();
    await j.compact();
    expect(j.stalledSince()).toBeNull();
  });

  it("a write that failed leaves no age behind", async () => {
    const { j, dia } = await moJournal();
    dia.loiWrite();
    await j.appendEvent(ev());
    expect(j.stalledSince()).toBeNull();
  });
});

describe("a2n fsyncOverrun — non-STOP closed until restart, records keep flowing once the disk returns", () => {
  it("★ the real consumeAuthorization past its bound: io_error, the jti stays consumed, non-STOP closed, the journal unhealthy", async () => {
    const { j, dia } = await moJournal();
    dia.treoSync();
    expect(await j.consumeAuthorization(J)).toEqual({ ok: false, reason: "io_error" });
    expect(j.isJtiConsumed("jti-a")).toBe(true);
    expect(j.admitNonStop()).toBe(false);
    expect(j.stats().healthy).toBe(false);
    expect(await j.consumeAuthorization({ ...J, jti: "jti-b" })).toEqual({ ok: false, reason: "io_error" });
    expect(j.isJtiConsumed("jti-b")).toBe(false); // refused BEFORE it is marked: nothing queued for it
    dia.tha();
  });

  it("★ after the overrun, the disk returns: non-STOP STILL closed (until restart), a new consume still refused", async () => {
    const { j, dia } = await moJournal();
    dia.treoSync();
    await j.consumeAuthorization(J);
    dia.tha();
    await j.flush();
    await nghi(10);
    expect(j.stalledSince()).toBeNull();
    expect(j.admitNonStop()).toBe(false);
    expect(j.stats().healthy).toBe(false);
    expect(await j.consumeAuthorization({ ...J, jti: "jti-c" })).toEqual({ ok: false, reason: "io_error" });
  });

  it("★ after the overrun, the disk returns: records queued behind it become durable and shippable", async () => {
    const { j, dia } = await moJournal();
    dia.treoSync();
    await j.consumeAuthorization(J);
    const rec = j.appendRun(9, 1, { kind: "step", stepId: "m1", stepType: "command", status: "running", attempt: 1, startedAt: 1, finishedAt: null, error: null, result: null, jti: null });
    await nghi(10);
    expect(j.pending("run:9:1")).toEqual([]); // not durable ⇒ not shippable
    expect(j.undurableCount("run:9:1")).toBe(1);
    dia.tha();
    expect(await rec).toMatchObject({ seq: 1, durable: true });
    expect(j.pending("run:9:1").map((e) => e.seq)).toEqual([1]);
    expect(j.undurableCount("run:9:1")).toBe(0);
  });

  it("★ markAuthorizationUnused past its bound: the same state; refused after it", async () => {
    const { j, dia } = await moJournal();
    dia.treoSync();
    expect(await j.markAuthorizationUnused({ ...J, reason: "expired_before_use" })).toEqual({ ok: false, reason: "io_error" });
    expect(j.admitNonStop()).toBe(false);
    dia.tha();
    await j.flush();
    expect(await j.markAuthorizationUnused({ ...J, jti: "jti-d", reason: "expired_before_use" })).toEqual({ ok: false, reason: "io_error" }); // the disk is back: still refused
    expect(j.isJtiConsumed("jti-d")).toBe(false);
  });

  it("★ a robot state sample is dropped as UNHEALTHY during an overrun, never as `journal_full`", async () => {
    const { j, dia } = await moJournal();
    dia.treoSync();
    await j.consumeAuthorization(J);
    expect(await j.appendRobotState(robot)).toMatchObject({ seq: null, dropped: true, reason: "unhealthy" });
    expect(j.stats().droppedRobotStates).toBe(1);
    dia.tha();
  });

  it("★ a STOP record still takes its bounded wait during the overrun, and is on disk once the disk returns", async () => {
    const { j, dia } = await moJournal();
    dia.treoSync();
    await j.consumeAuthorization(J);
    const t0 = Date.now();
    const r = await j.appendEvent({ kind: "stop", target: { robotId: 2 }, source: "local", requestId: null, outcome: "sent", at: 1, detail: null }, { stop: true });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(r).toMatchObject({ seq: 1, durable: false });
    dia.tha();
    await j.flush();
    expect(j.pending("events").map((e) => e.seq)).toEqual([1]);
  });

  it("★ a REAL fsync error stays an IO failure: nothing more is written, nothing queued comes back", async () => {
    const { j, dia } = await moJournal();
    dia.loiSync();
    expect(await j.flush()).toBe(false);
    expect(j.admitNonStop()).toBe(false);
    const n = dia.dem.write;
    const r = await j.appendEvent(ev());
    expect(r).toMatchObject({ durable: false });
    expect(dia.dem.write).toBe(n);
    expect(j.pending("events")).toEqual([]);
  });

  it("★ a restart opens it again: non-STOP admitted, the record queued behind the overrun is there, the jti still consumed", async () => {
    const dir = await tam.mk();
    const dia = diskGia();
    dias.push(dia);
    const j1 = await EdgeJournal.open({ dir, io: dia.io, groupCommitMs: 0, authSyncTimeoutMs: 30, stopBoundMs: 30, log: () => undefined });
    dia.treoSync();
    await j1.consumeAuthorization(J);
    dia.tha();
    await j1.flush();
    expect(j1.admitNonStop()).toBe(false);
    await j1.close();
    const j2 = await EdgeJournal.open({ dir, groupCommitMs: 0, log: () => undefined });
    mo.push(j2);
    expect(j2.admitNonStop()).toBe(true);
    expect(j2.stats().healthy).toBe(true);
    expect(j2.isJtiConsumed("jti-a")).toBe(true);
    expect(await j2.consumeAuthorization(J)).toEqual({ ok: false, reason: "jti_consumed" });
  });
});
