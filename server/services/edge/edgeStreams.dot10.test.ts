/**
 * doc 81 Đợt 10 task E (design §2.6, §2.7, §2.11) — edgeStreams against a fake central (real journal, temp dir):
 *   • the shipper sends each stream from its cursor in order, a duplicate is acknowledged, a gap is resent from central's
 *     expectedSeq; unreachable central leaves everything in the journal;
 *   • a run stream that can no longer be reported becomes events evidence (STOP results kept);
 *   • the telemetry insert function THROWS when central is unreachable (so storeForward buffers) and maps rows to samples;
 *   • motion-lock helpers: every transition becomes a `lock` event with the owner epoch; the boot seed never goes backwards
 *     and starts LOCKED when the journal knows nothing (persistUnknown) or the owner epoch changed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EdgeCentralClient } from "./edgeCentralClient";
import { FakeCentral, KIT_TOKEN } from "./edgeFakeCentral.testkit";
import { EdgeJournal } from "./edgeJournal";
import { EdgeCentralUnavailableError, EdgeStreamShipper, createEdgeReportSink, edgeMotionLockPersistence, edgeMotionLockSeed, edgeTelemetryPersistFn, telemetryRowsToSamples } from "./edgeStreams";

const dirs: string[] = [];
const journals: EdgeJournal[] = [];
afterEach(async () => {
  for (const j of journals.splice(0)) await j.close().catch(() => undefined);
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});
async function setup() {
  const central = new FakeCentral();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-streams-"));
  dirs.push(dir);
  const journal = await EdgeJournal.open({ dir, groupCommitMs: 1 });
  journals.push(journal);
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl, log: () => undefined });
  const shipper = new EdgeStreamShipper(journal, client, { log: () => undefined });
  return { central, journal, client, shipper };
}
const step = (stepId: string) => ({ kind: "step" as const, stepId, stepType: "command", status: "completed" as const, attempt: 1, startedAt: 1, finishedAt: 2, error: null, result: null, jti: null });

describe("doc 81 Đợt 10 E — the stream shipper", () => {
  it("★ in order from the cursor; acked records leave the journal; offline keeps them; the run stream needs the claim token", async () => {
    const { central, journal, shipper } = await setup();
    for (const s of ["a", "b", "c"]) await journal.appendRun(9, 1, step(s));
    expect(await shipper.flush("run:9:1")).toBe("no_token");
    shipper.setClaim(9, 1, `ect_${"A".repeat(43)}`);
    central.down = true;
    expect(await shipper.flush("run:9:1")).toBe("unavailable");
    expect(journal.pending("run:9:1")).toHaveLength(3);
    central.down = false;
    expect(await shipper.flush("run:9:1")).toBe("ok");
    expect(central.received.report.map((r) => [r.seq, r.stepId])).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
    expect(central.callsTo("report")[1].body).toMatchObject({ claimSeq: 1, epoch: journal.epoch, stream: "run:9:1" });
    expect(journal.pending("run:9:1")).toEqual([]);
  });

  it("★ a gap answer: central already holds more ⇒ skip ahead; central lost records this journal no longer has ⇒ refused (never silently)", async () => {
    const { central, journal, shipper } = await setup();
    for (let i = 0; i < 4; i++) await journal.appendEvent({ kind: "anomaly", code: "X", runId: null, detail: String(i), at: 1 });
    central.cursors.set(`${journal.epoch}|events`, 2); // central has 1..2 already (e.g. answer lost)
    let first = true;
    central.handlers.locksEvents = (b) => {
      if (first) {
        first = false;
        return { status: 409, code: "gap", details: { expectedSeq: 3 } };
      }
      return { status: 200, data: { ackedSeq: b.records[b.records.length - 1].seq, applied: b.records.length, duplicates: 0 } };
    };
    expect(await shipper.flush("events")).toBe("ok");
    expect(central.callsTo("locksEvents")[1].body.records.map((r: { seq: number }) => r.seq)).toEqual([3, 4]);
    await journal.appendEvent({ kind: "anomaly", code: "X", runId: null, detail: "5", at: 1 });
    central.handlers.locksEvents = () => ({ status: 409, code: "gap", details: { expectedSeq: 2 } });
    const before = central.callsTo("locksEvents").length;
    expect(await shipper.flush("events")).toBe("refused");
    expect(central.callsTo("locksEvents").length - before).toBe(1); // one answer, no busy loop
    expect(journal.pending("events")).toHaveLength(1);
  });

  it("★ R-10-z: a gap whose cursor is BEYOND what this shipper sent acks nothing (anomaly), records kept; within it, acks only up to what was sent", async () => {
    const { central, journal, shipper } = await setup();
    shipper.setClaim(9, 1, `ect_${"A".repeat(43)}`);
    for (const s of ["a", "b", "c"]) await journal.appendRun(9, 1, step(s));
    central.handlers.report = () => ({ status: 409, code: "gap", details: { expectedSeq: 10 } });
    expect(await shipper.flush("run:9:1")).toBe("refused");
    expect(journal.ackedSeq("run:9:1")).toBe(0);
    expect(journal.pending("run:9:1")).toHaveLength(3);
    expect(journal.pending("events").map((e) => (e.record as { code?: string }).code)).toEqual(["EDGE_STREAM_CURSOR_AHEAD"]);
    // central holds 1..2 of the 3 sent ⇒ ack 2, resend 3
    let first = true;
    central.handlers.report = (b) => {
      if (first) {
        first = false;
        return { status: 409, code: "gap", details: { expectedSeq: 3 } };
      }
      return { status: 200, data: { ackedSeq: b.records[b.records.length - 1].seq, applied: b.records.length, duplicates: 0 } };
    };
    expect(await shipper.flush("run:9:1")).toBe("ok");
    expect(central.callsTo("report").slice(-1)[0].body.records.map((r: { seq: number }) => r.seq)).toEqual([3]);
  });

  it("★ central acknowledges only part of a batch ⇒ only that part leaves the journal; the rest is sent again", async () => {
    const { central, journal, shipper } = await setup();
    shipper.setClaim(9, 1, `ect_${"A".repeat(43)}`);
    for (const s of ["a", "b", "c"]) await journal.appendRun(9, 1, step(s));
    central.handlers.report = (b) => ({ status: 200, data: { ackedSeq: b.records[0].seq, applied: 1, duplicates: 0 } });
    expect(await shipper.flush("run:9:1")).toBe("ok");
    expect(central.callsTo("report").map((c) => c.body.records.map((r: { seq: number }) => r.seq))).toEqual([[1, 2, 3], [2, 3], [3]]);
  });

  it("★ R-10-z: orphaned run stream ⇒ EVERY ledger record (STOP and non-STOP) becomes an `actuation` evidence event; the rest one anomaly", async () => {
    const { central, journal, shipper } = await setup();
    const JTI = "0b8f3c1e-5d7a-4c1b-9a2e-000000000001";
    await journal.appendRun(9, 1, { kind: "ledger", stepId: "abort:s", attempt: 1, idempotencyKey: "k", jti: null, stop: true, target: { adapterId: 21, commandType: "stop" }, status: "failed", result: null, at: 3 });
    await journal.appendRun(9, 1, { kind: "ledger", stepId: "m1", attempt: 2, idempotencyKey: "run9-m1-a2", jti: JTI, stop: false, target: { robotId: 12, jobType: "move" }, status: "done", result: null, at: 4 });
    await journal.appendRun(9, 1, step("m1"));
    expect(await shipper.orphanRunStream("run:9:1", "claim gone")).toBe(3);
    await shipper.flush("events");
    const ev = central.received.locksEvents;
    expect(ev.filter((r) => r.kind === "actuation").map((r) => [r.runId, r.claimSeq, r.stepId, r.attempt, r.jti, r.stop, r.target, r.outcome])).toEqual([
      [9, 1, "abort:s", 1, null, true, { adapterId: 21, commandType: "stop" }, "failed"],
      [9, 1, "m1", 2, JTI, false, { robotId: 12, jobType: "move" }, "done"],
    ]);
    expect(ev.filter((r) => r.kind === "anomaly").map((r) => r.code)).toEqual(["EDGE_RUN_REPORT_ORPHANED"]);
    expect(journal.pending("run:9:1")).toEqual([]);
  });

  it("★ R-10-z: with a FULL journal, actuation evidence and command acks are still written (never dropped)", async () => {
    const { client, central } = await setup();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-streams-full-"));
    dirs.push(dir);
    const journal = await EdgeJournal.open({ dir, groupCommitMs: 1, maxBytes: 2_000 });
    journals.push(journal);
    const shipper = new EdgeStreamShipper(journal, client, { log: () => undefined });
    await journal.appendRun(9, 1, { kind: "ledger", stepId: "m1", attempt: 1, idempotencyKey: "k", jti: null, stop: false, target: { robotId: 12, jobType: "move" }, status: "done", result: null, at: 4 });
    while (!journal.isFull()) await journal.appendRun(9, 1, step("fill"));
    expect(journal.admitNonStop()).toBe(false);
    await shipper.orphanRunStream("run:9:1", "claim gone");
    const ack = await journal.appendEvent({ kind: "command_ack", requestId: 5, outcome: "done", generation: null, at: 1, target: { robotId: 12 }, ownerEpoch: 3 }, { stop: true });
    expect(ack.seq).not.toBeNull();
    await shipper.flush("events");
    expect(central.received.locksEvents.map((r) => r.kind)).toEqual(["actuation", "anomaly", "command_ack"]);
  });

  it("the report sink journals first and nudges the shipper", async () => {
    const { central, journal, shipper } = await setup();
    const sink = createEdgeReportSink(journal, (s) => shipper.nudge(s));
    const r = await sink.event({ kind: "refusal", runId: 9, stepId: "m1", reason: "journal_full", at: 1 });
    expect(r).toMatchObject({ seq: 1, durable: true });
    await new Promise((res) => setTimeout(res, 50));
    expect(central.received.locksEvents.map((x) => x.kind)).toEqual(["refusal"]);
  });
});

describe("doc 81 Đợt 10 E — telemetry insert function", () => {
  const row = (over: Record<string, unknown> = {}) => ({ ts: new Date(1_790_000_000_000), metric: "temp", numValue: 2.5, textValue: null, boolValue: null, quality: "good", unit: "C", meta: { adapterId: 21, tagKey: "temp" }, ...over }) as never;

  it("★ maps rows to owned-adapter samples; rows without an adapter id are not sent", () => {
    const { samples, skipped } = telemetryRowsToSamples([row(), row({ meta: null }), row({ numValue: null, boolValue: true })]);
    expect(skipped).toBe(1);
    expect(samples).toEqual([
      { adapterId: 21, tagKey: "temp", ts: 1_790_000_000_000, value: 2.5, quality: "good", unit: "C" },
      { adapterId: 21, tagKey: "temp", ts: 1_790_000_000_000, value: true, quality: "good", unit: "C" },
    ]);
  });

  it("★ central unreachable ⇒ THROWS (storeForward buffers); refused samples are counted, not retried", async () => {
    const { central, client } = await setup();
    const fn = edgeTelemetryPersistFn(client, () => undefined);
    central.down = true;
    await expect(fn([row()])).rejects.toBeInstanceOf(EdgeCentralUnavailableError);
    central.down = false;
    central.handlers.telemetry = (b) => ({ status: 200, data: { accepted: 0, refused: b.samples.length } });
    expect(await fn([row()])).toBe(1);
  });
});

describe("doc 81 Đợt 10 E — motion lock helpers (lock authority on the edge)", () => {
  const robot = (over: Record<string, unknown> = {}) => ({ ...new FakeCentral().makeConfig().robots[0], ...over }) as never;

  it("★ every transition becomes a lock event with the robot's owner epoch (a STOP clear bounded like a STOP)", async () => {
    const { central, journal, shipper } = await setup();
    const sink = createEdgeReportSink(journal, (s) => shipper.nudge(s));
    const p = edgeMotionLockPersistence(sink, 12, () => 3);
    p.locked({ locked: true, reasonCode: "linkLost", since: new Date(5_000).toISOString(), generation: 2 });
    p.cleared({ locked: false, reasonCode: "linkLost", since: new Date(5_000).toISOString(), generation: 2, clearedBy: "stop_confirmed", clearedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 50));
    await shipper.flush("events");
    expect(central.received.locksEvents.map((r) => [r.event, r.generation, r.ownerEpoch, r.clearedBy])).toEqual([
      ["locked", 2, 3, null],
      ["cleared", 2, 3, "stop"],
    ]);
    expect(journal.motionLock(12)).toMatchObject({ kind: "clear", generation: 2 });
  });

  it("★ the boot seed: unknown ⇒ locked persistUnknown above every known generation; owner epoch changed ⇒ locked; never backwards", () => {
    const j = (s: ReturnType<EdgeJournal["motionLock"]>) => ({ motionLock: () => s });
    const u = edgeMotionLockSeed(j({ kind: "unknown" }), robot({ motionLock: { reasonCode: "x", generation: 6, authority: "edge:7", ownerEpoch: 3, lockedAt: 1 }, motionLockGenerationFloor: 4 }));
    expect(u).toMatchObject({ source: "unknown", generationBase: 7, locked: { reasonCode: "persistUnknown", generation: 7 } });
    expect(edgeMotionLockSeed(j({ kind: "clear", generation: 9, ownerEpoch: 2 }), robot())).toMatchObject({ source: "ownerChanged", generationBase: 10, locked: { reasonCode: "ownerChanged" } });
    expect(edgeMotionLockSeed(j({ kind: "clear", generation: 9, ownerEpoch: 3 }), robot({ motionLockGenerationFloor: 2 }))).toEqual({ locked: null, generationBase: 9, source: "clear" });
    expect(edgeMotionLockSeed(j({ kind: "locked", generation: 9, reasonCode: "dispatch", ownerEpoch: 3, since: 1 }), robot())).toMatchObject({ source: "journal", locked: { reasonCode: "dispatch", generation: 9 } });
    expect(edgeMotionLockSeed(j({ kind: "clear", generation: 4, ownerEpoch: 3 }), robot({ motionLock: { reasonCode: "ownerChanged", generation: 5, authority: "edge:7", ownerEpoch: 3, lockedAt: 1 } }))).toMatchObject({ source: "config", locked: { generation: 5 } });
  });
});
