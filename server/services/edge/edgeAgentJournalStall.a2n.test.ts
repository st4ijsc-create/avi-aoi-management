/**
 * Đĩa edge treo (a2n) — the AGENT half. Real journal over real files with a hand on the io, real client, real shipper, FakeCentral; a walker that stands
 * until told. The clock of the journal and of the agent is the test's, so the 5 s threshold costs no 5 s:
 *   • `progress` carries journalStalledSinceMs only for a write / fsync of ≥ EDGE_JOURNAL_STALL_ALERT_MS, and only to a central that advertised it
 *     (the request schema is strict: an old central answers 400 to the field);
 *   • the field changes nothing else of a tick: seq, cadence, the claim fields;
 *   • a stall that was REPORTED ends in one anomaly on the events stream; one that was not, in nothing;
 *   • an idle node reports nothing: no run stands on its disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { choDen, edgeTrenDiaGia, nghi, thuMucTam } from "./edgeDiskStall.testkit";
import { EDGE_JOURNAL_STALL_ALERT_MS } from "./edgeExecutionAgent";
import { EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE, EDGE_ACCEPTS_PROGRESS_JOURNAL_STALL, EDGE_CENTRAL_ACCEPTS, EDGE_JOURNAL_STALL_RECOVERED_CODE, edgeProgressRequestSchema } from "./edgeProtocol";

const tam = thuMucTam();
const don: Array<() => Promise<void>> = [];
beforeEach(() => {
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const f of don.splice(0)) await f();
  await tam.don();
  vi.restoreAllMocks();
});

async function dung(o: { accepts?: readonly string[] | null } = {}) {
  const x = await edgeTrenDiaGia(tam, o);
  don.push(x.dong);
  return x;
}
type H = Awaited<ReturnType<typeof dung>>;

const progress = (x: H) => x.central.callsTo("progress").map((c) => c.body as Record<string, unknown>);
const fields = (x: H) => progress(x).filter((b) => b.journalStalledSinceMs !== undefined);
async function runDung(x: H) {
  x.central.addRun(41);
  await x.agent.tick();
  await choDen(() => progress(x).length >= 1, "first progress");
}
/** n more ticks of the live segment */
async function themTick(x: H, n = 3) {
  const moc = progress(x).length;
  await choDen(() => progress(x).length >= moc + n, `${n} more progress ticks`);
}
/** a hung fsync started at the clock's now; the test moves the clock */
async function treoFsync(x: H) {
  x.dia.treoSync();
  const f = x.journal.flush();
  await choDen(() => x.journal.stalledSince() !== null, "fsync under way");
  return { since: x.journal.stalledSince() as number, xong: f };
}
const hoi = async (x: H) => {
  x.dia.tha();
  await x.journal.flush();
};
/** the anomalies central received on the events stream */
async function anomaly(x: H) {
  await x.agent.tick();
  await nghi(5);
  await x.journal.flush();
  await x.shipper.flushAll();
  return x.central.received.locksEvents.filter((r) => r.kind === "anomaly" && r.code === EDGE_JOURNAL_STALL_RECOVERED_CODE);
}

describe("a2n — progress carries the age of a stalled journal", () => {
  it("★ under 5 s no field; at 5 s the field names the start of the call", async () => {
    const x = await dung();
    await runDung(x);
    const { since } = await treoFsync(x);
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS - 1;
    await themTick(x);
    expect(fields(x)).toEqual([]);
    x.clock.t += 1;
    await themTick(x);
    expect(fields(x).length).toBeGreaterThan(0);
    expect(new Set(fields(x).map((b) => b.journalStalledSinceMs))).toEqual(new Set([since]));
  });

  it("★ a hung WRITE reports the same way", async () => {
    const x = await dung();
    await runDung(x);
    const moc = x.clock.t;
    x.dia.treoWrite();
    void x.journal.appendEvent({ kind: "anomaly", code: "T", runId: null, detail: "x", at: 1 });
    await choDen(() => x.dia.dem.write > 0, "write under way");
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await themTick(x);
    expect(fields(x)[0]?.journalStalledSinceMs).toBe(moc);
  });

  it("★ a slow fsync that ended before the threshold never reports: the age is of ONE call, not of the queue", async () => {
    const x = await dung();
    await runDung(x);
    for (let i = 0; i < 3; i++) {
      const { xong } = await treoFsync(x);
      x.clock.t += 2_000; // 6 s of slow disk in all, no single call past 2 s
      await themTick(x, 1);
      x.dia.tha();
      await xong;
    }
    await themTick(x);
    expect(fields(x)).toEqual([]);
  });

  it("★ a central that advertises nothing, or only the older token, never gets the field (its strict schema would answer 400)", async () => {
    for (const accepts of [null, [EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE]]) {
      const x = await dung({ accepts });
      await runDung(x);
      await treoFsync(x);
      x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS * 2;
      await themTick(x);
      expect(fields(x)).toEqual([]);
      x.dia.tha();
    }
  });

  it("★ a central that advertises it does: the token is on the list central sends", async () => {
    expect(EDGE_CENTRAL_ACCEPTS).toContain(EDGE_ACCEPTS_PROGRESS_JOURNAL_STALL);
    const x = await dung({ accepts: [EDGE_ACCEPTS_PROGRESS_JOURNAL_STALL] });
    await runDung(x);
    await treoFsync(x);
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await themTick(x);
    expect(fields(x).length).toBeGreaterThan(0);
  });

  it("★ the field changes nothing else of the tick: seq goes up by one, every body passes the strict schema", async () => {
    const x = await dung();
    await runDung(x);
    await themTick(x);
    await treoFsync(x);
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await themTick(x, 5);
    const b = progress(x);
    expect(fields(x).length).toBeGreaterThan(2);
    for (let i = 1; i < b.length; i++) expect(b[i].seq).toBe((b[i - 1].seq as number) + 1);
    for (const r of b) expect(edgeProgressRequestSchema.safeParse(r).success).toBe(true);
    expect(Object.keys(fields(x)[0]).sort()).toEqual(["claimSeq", "claimToken", "journalStalledSinceMs", "seq"]);
  });

  it("★ an idle node reports nothing: no run stands on its disk, no progress to carry it", async () => {
    const x = await dung();
    await treoFsync(x);
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS * 3;
    await x.agent.tick();
    await x.agent.tick();
    expect(x.central.callsTo("pull").length).toBeGreaterThanOrEqual(2);
    expect(progress(x)).toEqual([]);
  });
});

describe("a2n — the end of a reported stall", () => {
  it("★ one anomaly, naming the start of the stall and the journal's health; no second one", async () => {
    const x = await dung();
    await runDung(x);
    const { since } = await treoFsync(x);
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await themTick(x);
    await hoi(x);
    const a = await anomaly(x);
    expect(a).toHaveLength(1);
    expect(a[0].detail).toContain(`since ${since}`);
    expect(a[0].detail).toContain("healthy=true");
    await x.agent.tick();
    expect(await anomaly(x)).toHaveLength(1);
  });

  it("★ a stall that overran an fsync bound: the anomaly says healthy=false", async () => {
    const x = await dung();
    await runDung(x);
    x.dia.treoSync();
    expect(await x.journal.consumeAuthorization({ jti: "jti-1", runId: 41, claimSeq: 1, stepId: "m1", attempt: 1 })).toEqual({ ok: false, reason: "io_error" });
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await themTick(x);
    expect(fields(x).length).toBeGreaterThan(0);
    await hoi(x);
    const a = await anomaly(x);
    expect(a).toHaveLength(1);
    expect(a[0].detail).toContain("healthy=false");
    expect(x.journal.admitNonStop()).toBe(false);
  });

  it("★ a stall under the threshold, ending or not, is never announced as over: nothing was reported", async () => {
    const x = await dung();
    await runDung(x);
    await treoFsync(x);
    x.clock.t += 1_000;
    await themTick(x);
    await x.agent.tick(); // a pull in the middle of it: an anomaly written now would reach central once the disk returns
    await hoi(x);
    expect(await anomaly(x)).toEqual([]);
  });

  it("★ a field central never took is not a report: no `recovered` for it", async () => {
    const x = await dung();
    x.central.handlers.progress = () => ({ status: 503, code: "edge_unavailable" });
    await runDung(x);
    await treoFsync(x);
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await themTick(x);
    expect(fields(x).length).toBeGreaterThan(0);
    await hoi(x);
    expect(await anomaly(x)).toEqual([]);
  });
});

describe("a2n — what `progress` does not cover: the walker has ended, `complete` waits on the disk", () => {
  it("★ no tick comes from a finished segment (central's lost-progress sweep is the layer that speaks here, edgeRunProgressLost.a2n)", async () => {
    const x = await dung();
    await runDung(x);
    x.dia.treoSync();
    void x.journal.appendRun(41, 1, { kind: "step", stepId: "m1", stepType: "command", status: "running", attempt: 1, startedAt: 1, finishedAt: null, error: null, result: null, jti: null });
    x.tha({ outcome: "completed" });
    await choDen(() => x.agent.liveRunIds().length === 0, "segment over");
    const n = progress(x).length;
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS * 2;
    await nghi(60);
    expect(progress(x).length).toBe(n);
    expect(x.central.callsTo("complete")).toEqual([]);
    await hoi(x);
    await x.shipper.flushAll();
    await x.agent.tick();
    await choDen(() => x.central.callsTo("complete").length === 1, "complete after the disk returned");
  });
});
