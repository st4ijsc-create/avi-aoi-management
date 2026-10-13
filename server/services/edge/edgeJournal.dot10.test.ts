/**
 * doc 81 Đợt 10 task E (design §2.2) — the edge JOURNAL (edgeJournal.ts): JSONL segments + an atomically renamed state.json,
 * a 128-bit epoch, per-stream sequences, durability classes. Measured here, on a real temp directory (no DB, no network):
 *   • a TRUNCATED last line (power cut mid-write) is ignored and cut off — never glued to the next record, never a reset;
 *   • a corrupt line that is NOT the tail, or an unreadable / missing snapshot next to segments ⇒ RESET: a new epoch, every
 *     robot's lock state `unknown` (persistUnknown, fail-closed), the old files kept aside, an EDGE_JOURNAL_RESET anomaly;
 *   • FSYNC ORDERING: `auth.consumed` resolves only after the fsync of the line holding the jti (the driver call comes after);
 *     group commit fsyncs many records with one sync within the window; a STOP record never waits beyond the STOP bound;
 *   • the epoch + per-stream seq survive a restart, a jti consumed once stays consumed, compaction keeps exactly the
 *     un-acknowledged records and never reuses a seq;
 *   • a FULL journal blocks only new non-STOP actuation: `auth.consumed` is refused, robot-state samples are dropped (counted),
 *     STOP / step / lock records are still written.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EdgeJournal, nodeEdgeJournalIo, type EdgeJournalFile, type EdgeJournalIo } from "./edgeJournal";
import { EDGE_EPOCH_RE } from "./edgeProtocol";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "edge-journal-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});

const JTI = (n: number) => `0b8f3c1e-5d7a-4c1b-9a2e-${String(n).padStart(12, "0")}`;
const step = (stepId: string, status: "running" | "completed" = "completed") => ({
  kind: "step" as const,
  stepId,
  stepType: "command",
  status,
  attempt: 1,
  startedAt: 1,
  finishedAt: status === "completed" ? 2 : null,
  error: null,
  result: null,
  jti: null,
});
const stopEvent = (robotId: number) => ({ kind: "stop" as const, target: { robotId }, source: "local" as const, requestId: null, outcome: "sent" as const, at: 5, detail: null });
const lockEvent = (robotId: number, event: "locked" | "cleared", generation: number) => ({
  kind: "lock" as const,
  robotId,
  event,
  generation,
  ownerEpoch: 3,
  reasonCode: "linkLost",
  since: 10,
  clearedBy: event === "cleared" ? ("stop" as const) : null,
  requestId: null,
});

async function segments(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort();
}
async function lastSegment(dir: string): Promise<string> {
  const s = await segments(dir);
  return path.join(dir, s[s.length - 1]);
}

/** IO that records the order of writes / syncs, with a sync gate the test opens. */
function recordingIo(): { io: EdgeJournalIo; events: string[]; holdSync: () => void; releaseSync: () => void; hangSync: () => void } {
  const events: string[] = [];
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let hang = false;
  const io: EdgeJournalIo = {
    ...nodeEdgeJournalIo,
    async openAppend(p: string): Promise<EdgeJournalFile> {
      const f = await nodeEdgeJournalIo.openAppend(p);
      return {
        async write(data: string) {
          for (const line of data.split("\n").filter(Boolean)) {
            const k = JSON.parse(line).k as string;
            events.push(`write:${k}`);
          }
          await f.write(data);
        },
        async sync() {
          events.push("sync:start");
          if (hang) await new Promise<void>(() => undefined);
          if (gate) await gate;
          await f.sync();
          events.push("sync:done");
        },
        close: () => f.close(),
      };
    },
  };
  return {
    io,
    events,
    holdSync: () => {
      gate = new Promise<void>((r) => (open = r));
    },
    releaseSync: () => {
      gate = null;
      open?.();
    },
    hangSync: () => {
      hang = true;
    },
  };
}

describe("doc 81 Đợt 10 E — edge journal: epoch, streams, restart", () => {
  it("★ a fresh journal opens a 128-bit epoch; EVERY restart opens a new one (fix review 2) — the old epoch's records stay, no seq is reused", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    expect(j1.epoch).toMatch(EDGE_EPOCH_RE);
    expect(j1.opened.kind).toBe("fresh");
    const a = await j1.appendRun(9, 2, step("m1"));
    const b = await j1.appendRun(9, 2, step("m2"));
    const e = await j1.appendEvent(stopEvent(4));
    expect([a.seq, b.seq, e.seq]).toEqual([1, 2, 1]);
    expect(j1.pending("run:9:2").map((r) => [r.epoch, r.stream, r.seq, r.record.kind])).toEqual([
      [j1.epoch, "run:9:2", 1, "step"],
      [j1.epoch, "run:9:2", 2, "step"],
    ]);
    await j1.close();

    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened).toMatchObject({ kind: "restored", unclean: false });
    expect(j2.epoch).not.toBe(j1.epoch); // a clean restart too: an epoch is never written by two processes
    expect(j2.pending("run:9:2", 99, j1.epoch).map((r) => r.seq)).toEqual([1, 2]); // shipped under ITS epoch
    expect((await j2.appendRun(9, 2, step("m3"))).seq).toBe(1);
    expect(j2.pending("events")).toEqual([]); // a clean restart reports no anomaly
    await j2.close();
  });

  it("★ a TRUNCATED last line is ignored and cut off — never glued to the next record, no reset; the crash opens a NEW epoch", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    await j1.appendRun(9, 2, step("m1"));
    await j1.appendRun(9, 2, step("m2"));
    await j1.flush();
    // a crash mid-write of the 3rd line: half a JSON object, no newline
    const seg = await lastSegment(dir);
    const full = await fs.readFile(seg, "utf8");
    const third = full.split("\n")[1];
    await fs.appendFile(seg, third.slice(0, Math.floor(third.length / 2)));
    // the process died: no close()
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened).toMatchObject({ kind: "restored", truncatedTail: true, unclean: true });
    expect(j2.epoch).not.toBe(j1.epoch); // R-10-ag — the crashed epoch is never written again
    expect(j2.pending("run:9:2", 99, j1.epoch).map((r) => r.seq)).toEqual([1, 2]); // still shipped, under ITS epoch
    expect((await j2.appendRun(9, 2, step("m3"))).seq).toBe(1); // a new epoch starts every stream at 1
    await j2.flush();
    // every line of the segment parses — the partial line is gone
    const lines = (await fs.readFile(await lastSegment(dir), "utf8")).split("\n").filter(Boolean);
    expect(lines.map((l) => [JSON.parse(l).e === j1.epoch, JSON.parse(l).q])).toEqual([[true, 1], [true, 2], [false, 1], [false, 1]]);
    await j2.close();
    const j3 = await EdgeJournal.open({ dir });
    expect(j3.opened).toMatchObject({ kind: "restored", truncatedTail: false, unclean: false });
    expect(j3.pending("run:9:2", 99, j2.epoch).map((r) => r.seq)).toEqual([1]);
    expect(j3.pendingStreams().map((r) => [r.epoch === j1.epoch ? "e1" : r.epoch === j2.epoch ? "e2" : "e3", r.stream]).sort()).toEqual([["e1", "run:9:2"], ["e2", "events"], ["e2", "run:9:2"]]);
    await j3.close();
  });

  it("★ R-10-ag: a crash between append and fsync never reuses a seq for other content, and the possible loss is reported", async () => {
    const dir = await tmp();
    const r = recordingIo();
    const j1 = await EdgeJournal.open({ dir, io: r.io, groupCommitMs: 1 });
    await j1.appendRun(9, 2, step("m1")); // durable
    r.hangSync();
    void j1.appendRun(9, 2, step("m2")); // written, never fsynced
    await new Promise((res) => setTimeout(res, 30));
    expect(j1.pending("run:9:2").map((e) => e.seq)).toEqual([1]); // m2 is NOT shippable — central never sees it
    expect(j1.undurableCount("run:9:2")).toBe(1);
    // crash; the OS lost m2 (power cut): cut it from the file
    const seg = await lastSegment(dir);
    const kept = (await fs.readFile(seg, "utf8")).split("\n")[0] + "\n";
    await fs.writeFile(seg, kept);
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened.unclean).toBe(true);
    expect(j2.epoch).not.toBe(j1.epoch);
    const next = await j2.appendRun(9, 2, step("other content"));
    expect(next.seq).toBe(1); // seq 2 of the crashed epoch is never written again: (epoch, stream, seq) stays unique
    expect(j2.pending("run:9:2", 99, j1.epoch).map((e) => (e.record as { stepId: string }).stepId)).toEqual(["m1"]);
    const ev = j2.pending("events");
    expect(ev[0].record).toMatchObject({ kind: "anomaly", code: "EDGE_JOURNAL_UNCLEAN_SHUTDOWN" });
    await j2.close();
  });

  it("★ a torn tail whose JSON parses but whose checksum does not match is treated as torn too (not trusted)", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    await j1.appendRun(9, 2, step("m1"));
    await j1.flush();
    const seg = await lastSegment(dir);
    const line = JSON.parse((await fs.readFile(seg, "utf8")).trim());
    line.q = 2;
    line.d.stepId = "forged";
    await fs.appendFile(seg, JSON.stringify(line)); // no newline, bad checksum
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened.truncatedTail).toBe(true);
    expect(j2.pending("run:9:2", 99, j1.epoch).map((r) => (r.record as { stepId: string }).stepId)).toEqual(["m1"]);
    await j2.close();
  });

  it("★ a bad last line that DOES end with its newline is not a torn append ⇒ reset (fail-closed), never silently skipped", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    await j1.appendRun(9, 2, step("m1"));
    await j1.close();
    await fs.appendFile(await lastSegment(dir), '{"e":"x","s":"run:9:2","q":2}\n');
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened.kind).toBe("reset");
    expect(j2.epoch).not.toBe(j1.epoch);
    await j2.close();
  });

  it("★ a corrupt line that is NOT the tail ⇒ reset: new epoch, robots unknown (persistUnknown), files kept aside, anomaly", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    await j1.appendEvent(lockEvent(12, "cleared", 4));
    await j1.appendRun(9, 2, step("m1"));
    await j1.appendRun(9, 2, step("m2"));
    await j1.close();
    const seg = await lastSegment(dir);
    const lines = (await fs.readFile(seg, "utf8")).split("\n");
    lines[1] = lines[1].replace(/"m1"/, '"mX"'); // checksum now wrong, in the MIDDLE
    await fs.writeFile(seg, lines.join("\n"));
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened.kind).toBe("reset");
    expect(j2.opened.reset?.reason).toMatch(/corrupt/);
    expect(j2.opened.reset?.unreported).toBe(2); // M-4 — the evidence moved aside is COUNTED (the readable lines: lock + m2)
    expect(j2.epoch).not.toBe(j1.epoch);
    expect(j2.motionLock(12)).toEqual({ kind: "unknown" });
    expect(j2.pending("run:9:2")).toEqual([]);
    const ev = j2.pending("events");
    expect(ev.map((r) => r.seq)).toEqual([1]); // a new epoch starts every stream at 1
    expect(ev[0].record).toMatchObject({ kind: "anomaly", code: "EDGE_JOURNAL_RESET" });
    expect((ev[0].record as { detail: string }).detail).toMatch(/2 readable record\(s\) never confirmed reported .*lock=1, step=1/);
    const kept = (await fs.readdir(dir)).filter((f) => f.startsWith("reset-"));
    expect(kept.length).toBe(1);
    expect((await fs.readdir(path.join(dir, kept[0]))).some((f) => f.endsWith(".jsonl"))).toBe(true);
    await j2.close();
  });

  it("★ an UNREADABLE snapshot ⇒ reset with a new epoch; every robot starts unknown (locked persistUnknown by the caller)", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    await j1.appendEvent(lockEvent(12, "cleared", 4));
    await j1.close();
    expect(j1.motionLock(12)).toMatchObject({ kind: "clear", generation: 4 });
    await fs.writeFile(path.join(dir, "state.json"), "{ not json");
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened.kind).toBe("reset");
    expect(j2.opened.reset?.reason).toMatch(/snapshot/);
    expect(j2.opened.reset?.previousEpoch).toBe(null);
    expect(j2.epoch).not.toBe(j1.epoch);
    expect(j2.motionLock(12)).toEqual({ kind: "unknown" });
    await j2.close();
    // the reset is itself durable: the next open RESTORES (no second reset), the reset epoch's records still pending under it
    const j3 = await EdgeJournal.open({ dir });
    expect(j3.opened.kind).toBe("restored");
    expect(j3.pending("events", 9, j2.epoch).map((e) => (e.record as { code?: string }).code)).toEqual(["EDGE_JOURNAL_RESET"]);
    await j3.close();
  });

  it("★ a well-formed line that REPEATS a seq with different content (not an interrupted compaction copy) ⇒ reset", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    await j1.appendRun(9, 2, step("m1"));
    await j1.appendRun(9, 2, step("m2"));
    await j1.close();
    const seg = await lastSegment(dir);
    const first = JSON.parse((await fs.readFile(seg, "utf8")).split("\n")[0]);
    const d = { ...first.d, stepId: "forged" };
    const h = createHash("sha256").update(JSON.stringify([first.e, first.s, 1, first.k, first.t, d]), "utf8").digest("hex").slice(0, 16);
    await fs.appendFile(seg, JSON.stringify({ e: first.e, s: first.s, q: 1, k: first.k, t: first.t, d, h }) + "\n" + (await fs.readFile(seg, "utf8")).split("\n")[1] + "\n");
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened.kind).toBe("reset");
    expect(j2.opened.reset?.reason).toMatch(/out of order/);
    await j2.close();
  });

  it("★ segments without a snapshot (state.json deleted) ⇒ reset, never a silent fresh start", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    await j1.appendRun(9, 2, step("m1"));
    await j1.close();
    await fs.unlink(path.join(dir, "state.json"));
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened.kind).toBe("reset");
    expect(j2.epoch).not.toBe(j1.epoch);
    await j2.close();
  });

  it("motion-lock state follows the lock records and survives restart + compaction", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    expect(j1.motionLock(12)).toEqual({ kind: "unknown" }); // nothing known yet — a fresh journal claims nothing
    await j1.appendEvent(lockEvent(12, "locked", 5));
    expect(j1.motionLock(12)).toMatchObject({ kind: "locked", generation: 5, reasonCode: "linkLost", ownerEpoch: 3 });
    await j1.appendEvent(lockEvent(12, "cleared", 5));
    await j1.appendEvent(lockEvent(12, "locked", 3)); // a late, OLDER generation never moves the state backwards
    expect(j1.motionLock(12)).toMatchObject({ kind: "clear", generation: 5 });
    j1.ack("events", 3);
    await j1.compact();
    await j1.close();
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.motionLock(12)).toMatchObject({ kind: "clear", generation: 5 });
    await j2.close();
  });
});

describe("doc 81 Đợt 10 E — edge journal: durability classes (fsync ordering)", () => {
  it("★ auth.consumed resolves ONLY after the fsync of the line holding the jti — the driver call can only come after", async () => {
    const dir = await tmp();
    const r = recordingIo();
    const j = await EdgeJournal.open({ dir, io: r.io });
    r.events.length = 0;
    r.holdSync();
    let resolved = false;
    const p = j.consumeAuthorization({ jti: JTI(1), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 }).then((v) => {
      resolved = true;
      r.events.push("driver");
      return v;
    });
    await new Promise((res) => setTimeout(res, 30));
    expect(resolved).toBe(false); // held while the fsync is held
    expect(r.events).toEqual(["write:auth.consumed", "sync:start"]);
    expect(j.isJtiConsumed(JTI(1))).toBe(true); // in memory at once: a concurrent second use is refused
    r.releaseSync();
    expect(await p).toEqual({ ok: true });
    expect(r.events).toEqual(["write:auth.consumed", "sync:start", "sync:done", "driver"]);
    await j.close();
  });

  it("★ fix review 7 (R-10-bp): auth.unused is fsynced BEFORE it resolves; the jti is consumed-as-unused (never usable, also after a restart); a USED jti is never marked unused", async () => {
    const dir = await tmp();
    const r = recordingIo();
    const j = await EdgeJournal.open({ dir, io: r.io });
    r.events.length = 0;
    r.holdSync();
    let resolved = false;
    const p = j.markAuthorizationUnused({ jti: JTI(7), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1, reason: "expired_before_use" }).then((v) => ((resolved = true), v));
    await new Promise((res) => setTimeout(res, 30));
    expect(resolved).toBe(false); // held while the fsync is held: nothing may report it yet
    expect(r.events).toEqual(["write:auth.unused", "sync:start"]);
    expect(j.isJtiConsumed(JTI(7))).toBe(true); // at once: never usable
    r.releaseSync();
    expect(await p).toEqual({ ok: true });
    expect(await j.consumeAuthorization({ jti: JTI(7), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 })).toEqual({ ok: false, reason: "jti_consumed" });
    expect(await j.markAuthorizationUnused({ jti: JTI(7), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1, reason: "expired_before_use" })).toEqual({ ok: false, reason: "jti_consumed" }); // reported once
    // a jti journaled as USED can never be reported unused
    expect(await j.consumeAuthorization({ jti: JTI(8), runId: 9, claimSeq: 2, stepId: "m2", attempt: 1 })).toEqual({ ok: true });
    expect(await j.markAuthorizationUnused({ jti: JTI(8), runId: 9, claimSeq: 2, stepId: "m2", attempt: 1, reason: "expired_before_use" })).toEqual({ ok: false, reason: "jti_consumed" });
    await j.close();
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.isJtiConsumed(JTI(7))).toBe(true); // replayed: still never usable
    expect(await j2.consumeAuthorization({ jti: JTI(7), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 })).toEqual({ ok: false, reason: "jti_consumed" });
    expect(await j2.markAuthorizationUnused({ jti: JTI(8), runId: 9, claimSeq: 2, stepId: "m2", attempt: 1, reason: "expired_before_use" })).toEqual({ ok: false, reason: "jti_consumed" });
    expect(await j2.markAuthorizationUnused({ jti: JTI(9), runId: 9, claimSeq: 2, stepId: "m3", attempt: 1, reason: "expired_before_use" })).toEqual({ ok: true });
    // the process dies (no close(), no snapshot): the fsynced auth.unused LINE alone keeps the jti unusable
    const j3 = await EdgeJournal.open({ dir });
    expect(j3.opened).toMatchObject({ unclean: true });
    expect(j3.isJtiConsumed(JTI(9))).toBe(true);
    expect(await j3.consumeAuthorization({ jti: JTI(9), runId: 9, claimSeq: 2, stepId: "m3", attempt: 1 })).toEqual({ ok: false, reason: "jti_consumed" });
    await j3.close();
  });

  it("★ a consumed jti is never consumed twice — not in this process, not after a restart", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir });
    expect(await j1.consumeAuthorization({ jti: JTI(2), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 })).toEqual({ ok: true });
    expect(await j1.consumeAuthorization({ jti: JTI(2), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 })).toEqual({ ok: false, reason: "jti_consumed" });
    await j1.close();
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.isJtiConsumed(JTI(2))).toBe(true);
    expect(await j2.consumeAuthorization({ jti: JTI(2), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 })).toEqual({ ok: false, reason: "jti_consumed" });
    await j2.close();
  });

  it("consumed jtis are pruned only after the retention (2 × max TTL by default)", async () => {
    const dir = await tmp();
    let now = 1_000_000;
    const j1 = await EdgeJournal.open({ dir, now: () => now });
    await j1.consumeAuthorization({ jti: JTI(3), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 });
    now += 59_000;
    await j1.compact();
    expect(j1.isJtiConsumed(JTI(3))).toBe(true);
    now += 2_000; // > 60 s
    await j1.compact();
    expect(j1.isJtiConsumed(JTI(3))).toBe(false);
    await j1.close();
  });

  it("★ group commit: many step records are made durable by ONE fsync within the window", async () => {
    const dir = await tmp();
    const r = recordingIo();
    const j = await EdgeJournal.open({ dir, io: r.io, groupCommitMs: 20 });
    r.events.length = 0;
    const t0 = Date.now();
    const out = await Promise.all([j.appendRun(9, 2, step("a")), j.appendRun(9, 2, step("b")), j.appendRun(9, 2, step("c"))]);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(out.map((o) => o.durable)).toEqual([true, true, true]);
    expect(r.events.filter((e) => e === "sync:done").length).toBe(1);
    expect(r.events.indexOf("sync:start")).toBeGreaterThan(r.events.lastIndexOf("write:step"));
    await j.close();
  });

  it("★ fix review 1 (M-5): a lock / clear event is fsynced AT ONCE, not in the group window — it survives a crash right after", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir, groupCommitMs: 60_000 });
    const t0 = Date.now();
    expect(await j1.appendEvent(lockEvent(12, "locked", 6))).toMatchObject({ durable: true });
    expect(await j1.appendEvent(lockEvent(12, "cleared", 6))).toMatchObject({ durable: true });
    expect(Date.now() - t0).toBeLessThan(5_000); // never the 60 s group window
    // crash right after (no close): the lock state comes back
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.motionLock(12)).toMatchObject({ kind: "clear", generation: 6 });
    await j2.close();
  });

  it("★ L-7: a STOP record never waits beyond the STOP bound even when the disk hangs; a non-STOP record keeps waiting", async () => {
    const dir = await tmp();
    const r = recordingIo();
    const j = await EdgeJournal.open({ dir, io: r.io, groupCommitMs: 5, stopBoundMs: 100 });
    r.hangSync();
    let stepDone = false;
    void j.appendRun(9, 2, step("m1")).then(() => (stepDone = true));
    const t0 = Date.now();
    const s = await j.appendEvent(stopEvent(4), { stop: true });
    const took = Date.now() - t0;
    expect(s).toMatchObject({ seq: 1, durable: false });
    expect(took).toBeLessThan(400); // bounded (100 ms + scheduling)
    expect(stepDone).toBe(false);
    // kept, but not shipped until it is durable (R-10-ag)
    expect(j.pending("events")).toEqual([]);
    expect(j.undurableCount("events")).toBe(1);
  });

  it("★ an auth.consumed fsync that never finishes ⇒ io_error within the bound (never ok), the jti stays consumed, the journal unhealthy", async () => {
    const dir = await tmp();
    const r = recordingIo();
    const j = await EdgeJournal.open({ dir, io: r.io, authSyncTimeoutMs: 100 });
    r.hangSync();
    const t0 = Date.now();
    expect(await j.consumeAuthorization({ jti: JTI(7), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 })).toEqual({ ok: false, reason: "io_error" });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(j.isJtiConsumed(JTI(7))).toBe(true);
    expect(j.admitNonStop()).toBe(false);
  });

  it("★ fix review 2: a reopen whose fsync of the previous segment FAILS ships none of the replayed records (they are not durable)", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir, groupCommitMs: 1 });
    await j1.appendRun(9, 2, step("m1"));
    // crash; reopen on a disk whose fsync fails
    const io: EdgeJournalIo = {
      ...nodeEdgeJournalIo,
      async openAppend(p) {
        const f = await nodeEdgeJournalIo.openAppend(p);
        return { write: (d) => f.write(d), sync: async () => Promise.reject(new Error("EIO")), close: () => f.close() };
      },
    };
    const j2 = await EdgeJournal.open({ dir, io });
    expect(j2.pending("run:9:2", 9, j1.epoch)).toEqual([]);
    expect(j2.undurableCount("run:9:2", j1.epoch)).toBe(1);
    expect(j2.stats().healthy).toBe(false);
  });

  it("an IO failure leaves the journal unable to admit non-STOP work (fail-closed); STOP appends still return", async () => {
    const dir = await tmp();
    const io: EdgeJournalIo = {
      ...nodeEdgeJournalIo,
      async openAppend(p) {
        const f = await nodeEdgeJournalIo.openAppend(p);
        return { write: async () => Promise.reject(new Error("EIO")), sync: () => f.sync(), close: () => f.close() };
      },
    };
    const j = await EdgeJournal.open({ dir, io });
    expect(j.admitNonStop()).toBe(true);
    expect((await j.appendRun(9, 2, step("m1"))).durable).toBe(false); // a failed record write alone …
    expect(j.admitNonStop()).toBe(false); // … already stops new non-STOP work
    expect(await j.consumeAuthorization({ jti: JTI(4), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 })).toEqual({ ok: false, reason: "io_error" });
    expect(j.admitNonStop()).toBe(false);
    expect(await j.appendEvent(stopEvent(4), { stop: true })).toMatchObject({ durable: false });
    expect(j.stats().healthy).toBe(false);
  });
});

describe("doc 81 Đợt 10 E — edge journal: bounds + compaction", () => {
  it("★ a FULL journal blocks only new non-STOP work: auth refused, robot state dropped (counted), STOP / step / lock still written; acks free whole segments", async () => {
    const dir = await tmp();
    const j = await EdgeJournal.open({ dir, maxBytes: 4_000, segmentMaxBytes: 600, groupCommitMs: 1 });
    let i = 0;
    for (let n = 0; n < 5_000 && !j.isFull(); n++) await j.appendRun(9, 2, step(`s${i++}`));
    expect(j.isFull()).toBe(true); // bounded loop: a compaction that freed un-acked bytes would never get here
    expect(j.admitNonStop()).toBe(false);
    expect(j.stats().full).toBe(true);
    expect(await j.consumeAuthorization({ jti: JTI(5), runId: 9, claimSeq: 2, stepId: "x", attempt: 1 })).toEqual({ ok: false, reason: "journal_full" });
    expect(j.isJtiConsumed(JTI(5))).toBe(false);
    const rs = await j.appendRobotState({ robotId: 4, ts: 1, busy: false });
    expect(rs).toMatchObject({ seq: null, dropped: true });
    expect(j.stats().droppedRobotStates).toBe(1);
    expect((await j.appendEvent(stopEvent(4), { stop: true })).seq).toBe(1);
    expect((await j.appendEvent(lockEvent(4, "locked", 2))).seq).toBe(2);
    expect((await j.appendRun(9, 2, step("after-full"))).seq).toBe(i + 1);
    // central acknowledges ⇒ compaction drops the fully-acked CLOSED segments ⇒ admission returns
    j.ack("run:9:2", i + 1);
    j.ack("events", 2);
    await j.flush();
    await j.appendEvent(stopEvent(4)); // a fresh record keeps the active segment non-empty
    await j.compact();
    expect(j.isFull()).toBe(false);
    expect(j.admitNonStop()).toBe(true);
    expect(await j.consumeAuthorization({ jti: JTI(6), runId: 9, claimSeq: 2, stepId: "x", attempt: 1 })).toEqual({ ok: true });
    await j.close();
  });

  it("★ R-10-ag: appends on a FULL journal stay O(1) — 10 000 appends, bounded time, nothing rewritten", async () => {
    const dir = await tmp();
    const r = recordingIo();
    const writes: number[] = [];
    const io: EdgeJournalIo = { ...r.io, writeFileAtomic: async (f, d) => (writes.push(d.length), nodeEdgeJournalIo.writeFileAtomic(f, d)) };
    const j = await EdgeJournal.open({ dir, io, maxBytes: 2_000, segmentMaxBytes: 64 * 1024, groupCommitMs: 5 });
    for (let n = 0; n < 5_000 && !j.isFull(); n++) await j.appendRun(9, 2, step("fill"));
    expect(j.isFull()).toBe(true);
    writes.length = 0;
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 10_000 }, (_, k) => j.appendEvent({ kind: "anomaly", code: "BENCH", runId: null, detail: String(k), at: 1 })));
    const took = Date.now() - t0;
    expect(j.isFull()).toBe(true);
    expect(took).toBeLessThan(15_000);
    // nothing un-acknowledged was ever rewritten: only new (empty) segment files + snapshots, never a record body
    expect(writes.every((len) => len === 0 || len < 20_000)).toBe(true);
    expect(j.pending("events").length).toBe(10_000);
    await j.close();
  }, 30_000);

  it("★ compaction drops only fully-acknowledged segments; a clean restart neither loses nor resends acked records", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir, segmentMaxBytes: 300, groupCommitMs: 1 });
    for (let k = 1; k <= 5; k++) await j1.appendRun(9, 2, step(`m${k}`));
    await j1.appendEvent(stopEvent(4));
    const segsBefore = (await segments(dir)).length;
    expect(segsBefore).toBeGreaterThan(2);
    const bytesBefore = j1.stats().bytes;
    j1.ack("run:9:2", 3);
    j1.ack("events", 1);
    await j1.compact();
    expect(j1.stats().bytes).toBeLessThan(bytesBefore);
    expect((await segments(dir)).length).toBeLessThan(segsBefore);
    expect(j1.pending("run:9:2").map((r) => r.seq)).toEqual([4, 5]);
    await j1.appendRun(9, 2, step("m6"));
    await j1.close();
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.opened.unclean).toBe(false);
    expect(j2.pending("run:9:2", 99, j1.epoch).map((r) => r.seq)).toEqual([4, 5, 6]);
    expect(j2.pending("events", 99, j1.epoch)).toEqual([]);
    expect((await j2.appendRun(9, 2, step("m7"))).seq).toBe(1);
    expect(j2.pendingStreams().map((r) => [r.epoch === j1.epoch, r.stream])).toEqual([[true, "run:9:2"], [false, "run:9:2"]]);
    await j2.close();
  });

  it("★ fix review 2: a CLOSED segment holding an un-acked STOP event and ledger record survives compact() and a reopen", async () => {
    const dir = await tmp();
    const j1 = await EdgeJournal.open({ dir, segmentMaxBytes: 400, groupCommitMs: 1 });
    await j1.appendEvent(stopEvent(4), { stop: true }); // events seq 1 — never acked
    await j1.appendRun(9, 2, { kind: "ledger", stepId: "abort:s", attempt: 1, idempotencyKey: "k", jti: null, stop: true, target: { robotId: 4, jobType: "abort" }, status: "done", result: null, at: 3 });
    const firstSeg = (await segments(dir))[0];
    for (let k = 0; k < 6; k++) await j1.appendEvent({ kind: "anomaly", code: "LATER", runId: null, detail: "x".repeat(80), at: 1 });
    expect((await segments(dir)).length).toBeGreaterThan(2);
    j1.ack("events", 1 + 6); // every event acked — only the run stream's ledger record of seg-1 is not
    await j1.compact();
    expect(await segments(dir)).toContain(firstSeg); // the ledger record keeps seg-1
    await j1.close();
    const j2 = await EdgeJournal.open({ dir });
    expect(j2.pending("run:9:2", 9, j1.epoch).map((e) => e.record.kind)).toEqual(["ledger"]);
    await j2.close();
    // and with the STOP event itself un-acked
    const dir2 = await tmp();
    const k1 = await EdgeJournal.open({ dir: dir2, segmentMaxBytes: 400, groupCommitMs: 1 });
    await k1.appendEvent(stopEvent(4), { stop: true });
    const seg1 = (await segments(dir2))[0];
    for (let k = 0; k < 6; k++) await k1.appendRun(9, 2, step(`m${k}`));
    k1.ack("run:9:2", 6);
    await k1.compact();
    expect(await segments(dir2)).toContain(seg1);
    await k1.close();
    const k2 = await EdgeJournal.open({ dir: dir2 });
    expect(k2.pending("events", 9, k1.epoch).map((e) => e.record.kind)).toEqual(["stop"]);
    await k2.close();
  });

  it("acks never move backwards and never past what was written", async () => {
    const dir = await tmp();
    const j = await EdgeJournal.open({ dir });
    await j.appendRun(9, 2, step("m1"));
    await j.appendRun(9, 2, step("m2"));
    j.ack("run:9:2", 2);
    j.ack("run:9:2", 1);
    expect(j.ackedSeq("run:9:2")).toBe(2);
    j.ack("run:9:2", 99);
    expect(j.ackedSeq("run:9:2")).toBe(2);
    expect(j.pending("run:9:2")).toEqual([]);
    await j.close();
  });
});
