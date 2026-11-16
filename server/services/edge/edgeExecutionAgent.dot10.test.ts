/**
 * doc 81 Đợt 10 task E — the EDGE AGENT v2 against a FAKE CENTRAL (edgeFakeCentral.testkit: signs what central signs, strict
 * answer shapes, report cursors). Real journal (temp dir), real client / config source / shipper / authorize client; the
 * walker (group C) and the device port (group D) are fakes. Measured:
 *   • claim → SIGNED package verified (node, run, claim, credential, defHash = hash of the shipped definition) → walk →
 *     /authorize → auth.consumed → report → complete {outcome, epoch, reportedThrough} — reports reach central BEFORE complete;
 *   • a forged / tampered package is never walked (released, anomaly reported);
 *   • abortRequested aborts the walker once (signal + abortLive); offline ⇒ nothing claimed, a walking run is HELD (D5) and its
 *     segment end is delivered once central is back;
 *   • commands: a STOP goes even when its signature fails (L-7, owned devices only), `clear` needs a valid, unexpired command
 *     and the owner epoch; duplicates run once; every command is acknowledged on the events stream;
 *   • stopsUnconfirmed: verified picture ⇒ the STOPs not confirmed before are re-sent (rate-limited); a forged picture still
 *     STOPs, with the CONFIG's pins only;
 *   • a full journal, commands-only mode, or no walker ⇒ nothing claimed; the credential never appears in a log line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EdgeCentralClient, createEdgeAuthorizeClient } from "./edgeCentralClient";
import { EdgeConfigSource } from "./edgeConfigSource";
import { EdgeExecutionAgent, type EdgeAgentConfig, type EdgeDevicePort, type EdgeRunIo, type EdgeSegmentOutcome, type EdgeWalker } from "./edgeExecutionAgent";
import { FakeCentral, KIT_TOKEN, kitHashDefinition } from "./edgeFakeCentral.testkit";
import { EdgeJournal, type EdgeReportableRecord } from "./edgeJournal";
import { EDGE_AUTH_TTL_MIN_MS } from "./edgeProtocol";
import { generateEdgeSigningKey, parseEdgeCanonicalJson } from "./edgeSigning";
import { EdgeProgramChecks, EdgeStreamShipper, createEdgeAuthUnusedReporter, createEdgeJournalConsume, createEdgeReportSink } from "./edgeStreams";
/** check:tests — EdgeReportableRecord gồm cả EdgeRobotStateRecord (KHÔNG có `kind`): đọc qua `in`, giá trị y như `record.kind` (vắng ⇒ undefined). */
const kindOf = (r: EdgeReportableRecord): string | undefined => ("kind" in r ? r.kind : undefined);

/**
 * fix review 1 (R-10-ag) — only DURABLE records ship. A record appended without awaiting (an anomaly, an ack) becomes durable
 * at the next group commit; the harness's explicit ship step fsyncs first, as the production loop's next commit would.
 */
function shipDurable(journal: EdgeJournal, shipper: EdgeStreamShipper): EdgeStreamShipper {
  const flushAll = shipper.flushAll.bind(shipper);
  const flush = shipper.flush.bind(shipper);
  shipper.flushAll = async () => {
    await journal.flush();
    return flushAll();
  };
  shipper.flush = async (stream: string, epoch?: string) => {
    await journal.flush();
    return flush(stream, epoch);
  };
  return shipper;
}


const PH = "sha256:" + "c".repeat(64);
const dirs: string[] = [];
const agents: EdgeExecutionAgent[] = [];
const journals: EdgeJournal[] = [];
afterEach(async () => {
  for (const a of agents.splice(0)) await a.stop();
  for (const j of journals.splice(0)) await j.close().catch(() => undefined);
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});
let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

function fakeDevices() {
  const calls: string[] = [];
  const port: EdgeDevicePort = {
    stopRobot: async (id) => (calls.push(`stopRobot:${id}`), { outcome: "sent" }),
    stopAdapter: async (id, pins) => (calls.push(`stopAdapter:${id}:${pins === null ? "config" : JSON.stringify(pins)}`), { outcome: "sent" }),
    lockRobot: async (id) => (calls.push(`lock:${id}`), { ok: true, generation: 4 }),
    clearRobot: async (id, g) => (calls.push(`clear:${id}:${g}`), g === 4 ? { ok: true as const, generation: 4 } : { ok: false as const, reason: "generation_mismatch" as const, generation: 4 }),
  };
  return { port, calls };
}

/** The reference walker: authorise m1 → consume the jti (fsync) → "move" → report the step with its jti → completed. */
function fakeWalker(over: Partial<{ hold: () => Promise<void> }> = {}) {
  const w = {
    drives: 0,
    motions: 0,
    aborts: [] as number[],
    signals: [] as AbortSignal[],
    lastAuth: null as null | Awaited<ReturnType<EdgeRunIo["authorize"]["authorize"]>>,
    walker: null as unknown as EdgeWalker,
  };
  w.walker = {
    drive: async (_pkg, io): Promise<EdgeSegmentOutcome> => {
      w.drives++;
      w.signals.push(io.signal);
      if (over.hold) await over.hold();
      if (io.signal.aborted) return { outcome: "aborted" };
      const a = await io.authorize.authorize({ runId: io.runId, claimSeq: io.claimSeq, claimToken: io.claimToken, stepId: "m1", attempt: 1, idempotencyKey: `foe:${io.runId}:m1:1`, command: { kind: "robot", robotId: 12, jobType: "move", params: {} }, payloadHash: PH });
      w.lastAuth = a;
      if (!a.ok) return a.verdict === "unavailable" ? { outcome: "held", heldReason: "centralUnreachable" } : { outcome: "failed", error: a.verdict };
      const c = await io.consume.consumeAuthorization({ jti: a.claims.jti, runId: io.runId, claimSeq: io.claimSeq, stepId: "m1", attempt: 1 });
      if (!c.ok) return { outcome: "failed", error: c.reason };
      io.authorize.settleNonce(a.reqNonce);
      w.motions++;
      await io.sink.run(io.runId, io.claimSeq, { kind: "step", stepId: "m1", stepType: "command", status: "completed", attempt: 1, startedAt: 1, finishedAt: 2, error: null, result: null, jti: a.claims.jti });
      return { outcome: "completed" };
    },
    abortLive: async (runId) => (w.aborts.push(runId), { live: true }),
  };
  return w;
}

async function harness(o: { central?: FakeCentral; walker?: EdgeWalker | null; claimRuns?: boolean; journalMaxBytes?: number; progressMs?: number; requestTimeoutMs?: number } = {}) {
  const central = o.central ?? new FakeCentral();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-agent-"));
  dirs.push(dir);
  const journal = await EdgeJournal.open({ dir, groupCommitMs: 1, maxBytes: o.journalMaxBytes });
  journals.push(journal);
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl });
  const config = await EdgeConfigSource.create({ client, pin: central.pin, nodeId: central.nodeId, credentialId: central.credentialId, credential: KIT_TOKEN, dir });
  expect(await config.refresh()).toMatchObject({ ok: true });
  const shipper = shipDurable(journal, new EdgeStreamShipper(journal, client));
  const sink = createEdgeReportSink(journal, (s) => shipper.nudge(s));
  const consume = createEdgeJournalConsume(journal);
  const programChecks = new EdgeProgramChecks({ config, client, read: async () => ({ status: "unsupported", source: "stub" }) });
  const authorize = createEdgeAuthorizeClient({
    client,
    trust: () => config.trust(),
    credentialId: () => config.credentialId(),
    maxTtlMs: () => 10_000,
    isJtiConsumed: (j) => journal.isJtiConsumed(j),
    programChecks: () => programChecks.latest(),
    anomaly: (code, runId, detail) => void sink.event({ kind: "anomaly", code, runId, detail, at: Date.now() }),
    unused: createEdgeAuthUnusedReporter(journal, sink),
  });
  const devices = fakeDevices();
  const w = fakeWalker();
  const cfg: EdgeAgentConfig = { centralUrl: "http://central.test", credential: KIT_TOKEN, pullIntervalMs: 60_000, progressMs: o.progressMs ?? 60_000, maxConcurrent: 2, requestTimeoutMs: o.requestTimeoutMs ?? 2_000, stopResendMinMs: 10_000, claimRuns: o.claimRuns };
  const agent = new EdgeExecutionAgent(cfg, {
    client,
    config,
    journal,
    shipper,
    sink,
    consume,
    authorize,
    programChecks,
    walker: o.walker === undefined ? w.walker : o.walker,
    devices: devices.port,
    hashDefinition: kitHashDefinition,
  });
  agents.push(agent);
  return { central, journal, client, config, shipper, agent, devices, w, dir };
}

const eventKinds = (c: FakeCentral) => c.received.locksEvents.map((r) => (r.kind === "anomaly" ? `anomaly:${r.code}` : r.kind === "command_ack" ? `ack:${r.requestId}:${r.outcome}` : r.kind === "stop" ? `stop:${r.source}:${JSON.stringify(r.target)}:${r.outcome}` : r.kind));

describe("doc 81 Đợt 10 E — agent v2: claim → signed package → walk → authorize → report → complete", () => {
  it("★ the happy path: package verified, one authorisation consumed, the step reported BEFORE the segment end", async () => {
    const h = await harness();
    h.central.addRun(9);
    const t = await h.agent.tick();
    expect(t.claimed).toEqual([9]);
    await h.agent.idle();
    expect(h.w.drives).toBe(1);
    expect(h.w.motions).toBe(1);
    const claim = h.central.callsTo("claim")[0];
    expect(claim.body).toMatchObject({ claimSeq: 0, defHash: kitHashDefinition({ steps: [{ id: "m1", type: "command" }] }) });
    expect(Array.isArray(claim.body.programChecks)).toBe(true);
    const order = h.central.calls.map((c) => c.route).filter((r) => ["claim", "authorize", "report", "complete"].includes(r));
    expect(order).toEqual(["claim", "authorize", "report", "complete"]);
    const auth = h.central.callsTo("authorize")[0].body;
    expect(auth).toMatchObject({ claimSeq: 1, stepId: "m1", attempt: 1, payloadHash: PH, command: { kind: "robot", robotId: 12 } });
    expect(auth.reqNonce).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    const rep = h.central.received.report;
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ kind: "step", stepId: "m1", status: "completed", seq: 1 });
    expect(rep[0].jti).toBe(h.w.lastAuth && h.w.lastAuth.ok ? h.w.lastAuth.claims.jti : "x");
    expect(h.journal.isJtiConsumed(rep[0].jti)).toBe(true);
    const done = h.central.callsTo("complete")[0].body;
    expect(done).toMatchObject({ claimSeq: 1, outcome: "completed", epoch: h.journal.epoch, reportedThrough: 1 });
    expect(h.central.calls.every((c) => c.auth === `Bearer ${KIT_TOKEN}`)).toBe(true);
  });

  it("★ a package signed by an attacker key / with a definition that does not hash to defHash is NEVER walked (released + anomaly)", async () => {
    for (const tamper of ["attackerKey", "definition"] as const) {
      const h = await harness();
      h.central.addRun(9);
      const evil = generateEdgeSigningKey().key;
      h.central.handlers.claim = (_b, runId) => {
        const pkg = h.central.runPackagePayload(runId!, 1);
        const payload = tamper === "definition" ? { ...pkg, definition: { steps: [{ id: "m1", type: "command", write: "evil" }] } } : pkg;
        return { status: 200, data: { runId, claimSeq: 1, claimToken: `ect_${"A".repeat(43)}`, package: h.central.sign("runpkg", payload, tamper === "attackerKey" ? { ...evil, kid: h.central.key.kid } : h.central.key) } };
      };
      const t = await h.agent.tick();
      expect(t.claimed).toEqual([]);
      expect(t.skipped[0].why).toMatch(/run package refused/);
      expect(h.w.drives).toBe(0);
      expect(h.central.callsTo("release")).toHaveLength(1);
      await h.shipper.flushAll();
      expect(eventKinds(h.central)).toContain("anomaly:EDGE_RUN_PACKAGE_INVALID");
      // backed off: not claimed again on the next pull
      h.central.addRun(9);
      expect((await h.agent.tick()).skipped[0].why).toMatch(/backing off/);
    }
  });

  it("★ abortRequested on progress aborts the walker ONCE (its signal + abortLive)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = fakeWalker({ hold: () => gate });
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    h.central.progressAbort = true;
    await vi.waitFor(() => expect(w.aborts).toEqual([9]), { timeout: 2_000 });
    expect(w.signals[0].aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 80)); // more progress answers with abortRequested
    expect(w.aborts).toEqual([9]);
    release();
    await h.agent.idle();
    expect(w.motions).toBe(0);
    expect(h.central.callsTo("authorize")).toHaveLength(0);
    expect(h.central.callsTo("complete")[0].body.outcome).toBe("aborted");
  });

  it("★ offline: nothing is claimed; a walking run whose authorisation cannot be fetched is HELD, delivered when central returns", async () => {
    const h = await harness();
    h.central.addRun(9);
    h.central.down = true;
    expect((await h.agent.tick()).online).toBe(false);
    expect(h.central.callsTo("claim")).toHaveLength(0);
    h.central.down = false;
    h.central.handlers.authorize = () => "network";
    h.central.handlers.complete = () => ({ status: 503, code: "edge_unavailable" });
    await h.agent.tick();
    await h.agent.idle();
    expect(h.w.motions).toBe(0);
    expect(h.w.lastAuth).toMatchObject({ ok: false, verdict: "unavailable" });
    expect(h.central.callsTo("authorize").length).toBe(2); // one retry with the SAME nonce
    const [a1, a2] = h.central.callsTo("authorize");
    expect(a2.body.reqNonce).toBe(a1.body.reqNonce);
    expect(h.central.callsTo("complete")).toHaveLength(1); // refused with 503 — kept, not dropped
    delete h.central.handlers.complete;
    await h.agent.tick(); // the pending segment end goes now
    const done = h.central.callsTo("complete");
    expect(done).toHaveLength(2);
    expect(done[done.length - 1].body).toMatchObject({ outcome: "held", heldReason: "centralUnreachable" });
  });

  it("★ a refused / stale authorisation is never actuated; an answer that fails verification is refused + anomaly", async () => {
    const h = await harness();
    h.central.addRun(9);
    h.central.handlers.authorize = (b) => ({ status: 200, data: { authorization: h.central.sign("auth", { typ: "avi-edge-auth+v1", nope: true, reqNonce: b.reqNonce }), ttlMs: 10_000 } });
    await h.agent.tick();
    await h.agent.idle();
    expect(h.w.motions).toBe(0);
    expect(h.w.lastAuth).toMatchObject({ ok: false, verdict: "refused", code: "auth_invalid" });
    await h.shipper.flushAll();
    expect(eventKinds(h.central)).toContain("anomaly:EDGE_AUTH_INVALID");
    const h2 = await harness();
    h2.central.addRun(9);
    h2.central.handlers.authorize = () => ({ status: 409, code: "gate_required", details: { reason: "approval missing" } });
    await h2.agent.tick();
    await h2.agent.idle();
    expect(h2.w.lastAuth).toMatchObject({ ok: false, verdict: "refused", reason: "approval missing" });
    expect(h2.w.motions).toBe(0);
  });

  it("★ fix review 7 (R-10-bp): a late authorisation is journaled UNUSED (fsync) and THEN reported on the run stream as `auth_unused`; never used; the step is held", async () => {
    const h = await harness();
    h.central.addRun(9);
    const kit = h.central as unknown as { defaults: (route: string, body: unknown, runId?: number) => { data: { authorization: { payload: string } } } };
    let lateJti = "";
    h.central.handlers.authorize = async (b, runId) => {
      const g = kit.defaults("authorize", b, runId);
      const claims = parseEdgeCanonicalJson(g.data.authorization.payload) as { jti: string; ttlMs: number };
      lateJti = claims.jti;
      const short = { ...claims, ttlMs: EDGE_AUTH_TTL_MIN_MS }; // the shortest token …
      await new Promise((r) => setTimeout(r, EDGE_AUTH_TTL_MIN_MS + 100)); // … answered after it lapsed (central slow)
      return { status: 200, data: { authorization: h.central.sign("auth", short), ttlMs: EDGE_AUTH_TTL_MIN_MS } };
    };
    const order: string[] = [];
    const markUnused = h.journal.markAuthorizationUnused.bind(h.journal);
    h.journal.markAuthorizationUnused = async (u) => (order.push("journal:auth.unused"), markUnused(u));
    const appendRun = h.journal.appendRun.bind(h.journal);
    h.journal.appendRun = (runId, claimSeq, rec, opts) => (order.push(`run:${rec.kind}`), appendRun(runId, claimSeq, rec, opts));
    await h.agent.tick();
    await h.agent.idle();
    expect(h.w.motions).toBe(0);
    expect(h.w.lastAuth).toMatchObject({ ok: false, verdict: "unavailable", code: "auth_expired" });
    expect(order.slice(0, 2)).toEqual(["journal:auth.unused", "run:auth_unused"]); // journaled first, reported second
    expect(h.journal.isJtiConsumed(lateJti)).toBe(true);
    expect(await h.journal.consumeAuthorization({ jti: lateJti, runId: 9, claimSeq: 1, stepId: "m1", attempt: 1 })).toEqual({ ok: false, reason: "jti_consumed" });
    await h.shipper.flushAll();
    const reported = h.central.received.report.filter((r: { kind: string }) => r.kind === "auth_unused");
    expect(reported).toEqual([{ kind: "auth_unused", seq: expect.any(Number), stepId: "m1", attempt: 1, jti: lateJti, reason: "expired_before_use", at: expect.any(Number) }]);
  });

  it("★ fix review 7 (R-10-bp): a late token whose jti was journaled as USED is never reported unused (no record on the run stream)", async () => {
    const h = await harness();
    const sink = createEdgeReportSink(h.journal);
    const report = createEdgeAuthUnusedReporter(h.journal, sink);
    const jti = "0a0b0c0d-0000-4000-8000-000000000001";
    expect(await h.journal.consumeAuthorization({ jti, runId: 9, claimSeq: 1, stepId: "m1", attempt: 1 })).toEqual({ ok: true });
    expect(await report({ runId: 9, claimSeq: 1, jti, stepId: "m1", attempt: 1, reason: "expired_before_use" })).toBe(false);
    expect(h.journal.pending("run:9:1").filter((p) => kindOf(p.record) === "auth_unused")).toEqual([]);
    const fresh = "0a0b0c0d-0000-4000-8000-000000000002";
    expect(await report({ runId: 9, claimSeq: 1, jti: fresh, stepId: "m1", attempt: 2, reason: "expired_before_use" })).toBe(true);
    expect(h.journal.pending("run:9:1").filter((p) => kindOf(p.record) === "auth_unused").map((p) => (p.record as { jti: string }).jti)).toEqual([fresh]);
  });

  it("★ nothing is claimed with a FULL journal, in commands-only mode, or without a walker", async () => {
    const full = await harness({ journalMaxBytes: 300 });
    while (!full.journal.isFull()) await full.journal.appendEvent({ kind: "anomaly", code: "FILL", runId: null, detail: "x".repeat(100), at: 1 });
    full.central.addRun(9);
    expect((await full.agent.tick()).skipped[0].why).toMatch(/journal is full/);
    const cmdOnly = await harness({ claimRuns: false });
    cmdOnly.central.addRun(9);
    await cmdOnly.agent.tick();
    const noWalker = await harness({ walker: null });
    noWalker.central.addRun(9);
    expect((await noWalker.agent.tick()).skipped[0].why).toMatch(/no edge walker/);
    for (const h of [full, cmdOnly, noWalker]) expect(h.central.callsTo("claim")).toHaveLength(0);
  });

  it("★ an answer that breaks the strict protocol (extra field) is treated as central unavailable — nothing claimed", async () => {
    const h = await harness();
    h.central.addRun(9);
    h.central.handlers.pull = () => ({ status: 200, data: { node: "edge-a", protocolVersion: 2, configVersion: 1, keysetVersion: 1, programCheckRequested: false, runs: h.central.runs, claims: [], stopsUnconfirmed: [], commands: [], trusted: true } });
    expect((await h.agent.tick()).online).toBe(false);
    expect(h.central.callsTo("claim")).toHaveLength(0);
  });

  it("group C's EdgeDriveResult shapes: `refused` ⇒ released (nothing completed); status only ⇒ that outcome", async () => {
    for (const [result, route, outcome] of [
      [{ ok: false, refused: "the run package is not for this claim" }, "release", null],
      [{ ok: true, status: "completed" }, "complete", "completed"],
      [{ ok: false, status: "aborted" }, "complete", "aborted"],
      [{ ok: true, status: "running" }, "complete", "failed"],
    ] as const) {
      const h = await harness({ walker: { drive: async () => result as never, abortLive: async () => ({ live: false }) } });
      h.central.addRun(9);
      await h.agent.tick();
      await h.agent.idle();
      expect(h.central.callsTo(route)).toHaveLength(1);
      if (outcome) expect(h.central.callsTo("complete")[0].body.outcome).toBe(outcome);
      else expect(h.central.callsTo("complete")).toHaveLength(0);
    }
  });

  it("a stale claim with no walker here is declared interrupted; one with a live walker is left to it", async () => {
    const h = await harness();
    h.central.claims = [{ runId: 5, claimSeq: 3, status: "running", abortRequested: false, stale: true }];
    const t = await h.agent.tick();
    expect(t.interrupted).toEqual([5]);
    expect(h.central.callsTo("interrupted")[0]).toMatchObject({ runId: 5, body: { claimSeq: 3 } });
  });
});

describe("doc 81 Đợt 10 E — agent v2: central commands (design §2.8)", () => {
  it("★ a verified STOP is sent at once and acknowledged; a duplicate delivery runs once — and is RE-ACKED (F-3: central re-delivers until it holds the ack)", async () => {
    const h = await harness({ claimRuns: false });
    const stop = h.central.sign("cmd", h.central.commandPayload({ requestId: 41, kind: "stop", target: { robotId: 12 } }));
    h.central.commands = [stop];
    await h.agent.tick();
    await h.agent.tick();
    expect(h.devices.calls).toEqual(["stopRobot:12"]);
    await h.shipper.flushAll();
    expect(eventKinds(h.central)).toEqual(['stop:command:{"robotId":12}:sent', "ack:41:done", "ack:41:done"]);
  });

  it("★ L-7: a STOP whose signature FAILS is still sent (owned device, config pins) + anomaly; a forged clear / lock is not applied", async () => {
    const h = await harness({ claimRuns: false });
    const evil = generateEdgeSigningKey().key;
    h.central.commands = [
      h.central.sign("cmd", h.central.commandPayload({ requestId: 50, kind: "clear", robotId: 12, expectedGeneration: 4, clearedBy: 9, reason: "x" }), evil),
      h.central.sign("cmd", h.central.commandPayload({ requestId: 51, kind: "lock", robotId: 12, reason: "x" }), evil),
      h.central.sign("cmd", h.central.commandPayload({ requestId: 52, kind: "stop", target: { adapterId: 21 } }), evil),
      h.central.sign("cmd", h.central.commandPayload({ requestId: 53, kind: "stop", target: { robotId: 999 } }), evil),
    ];
    const t = await h.agent.tick();
    expect(h.devices.calls).toEqual(["stopAdapter:21:config"]); // STOP first; never the unowned robot; no clear / lock
    // the STOP for robot 999 (unknown) is first pending, then — after the forced refresh of this cycle — not ours: never executed
    expect(t.commands.map((c) => c.outcome)).toEqual(["unverified:sent", "unverified:pending:not_yet_known", "unverified:not_owned", "refused:unknown_kid", "refused:unknown_kid"]);
    await h.shipper.flushAll();
    const ev = eventKinds(h.central);
    expect(ev.filter((e) => e === "anomaly:EDGE_COMMAND_INVALID")).toHaveLength(5);
    expect(ev).toContain('stop:anomaly:{"adapterId":21}:sent');
    expect(ev.some((e) => e.startsWith("ack:"))).toBe(false); // an unverified requestId is never acknowledged
  });

  it("★ clear (raises energy): expired ⇒ not applied; owner epoch mismatch ⇒ refused; right generation ⇒ cleared; wrong ⇒ refused", async () => {
    const h = await harness({ claimRuns: false });
    h.central.commands = [
      h.central.sign("cmd", h.central.commandPayload({ requestId: 60, kind: "clear", robotId: 12, expectedGeneration: 4, clearedBy: 9, reason: "x", issuedAt: Date.now() - 120_000, expiresAt: Date.now() - 60_000 })),
      h.central.sign("cmd", h.central.commandPayload({ requestId: 61, kind: "clear", robotId: 12, expectedGeneration: 4, clearedBy: 9, reason: "x", ownerEpoch: 2 })),
      h.central.sign("cmd", h.central.commandPayload({ requestId: 62, kind: "clear", robotId: 12, expectedGeneration: 3, clearedBy: 9, reason: "x" })),
      h.central.sign("cmd", h.central.commandPayload({ requestId: 63, kind: "clear", robotId: 12, expectedGeneration: 4, clearedBy: 9, reason: "x" })),
      h.central.sign("cmd", h.central.commandPayload({ requestId: 64, kind: "lock", robotId: 12, reason: "operator" })),
    ];
    await h.agent.tick();
    expect(h.devices.calls).toEqual(["clear:12:3", "clear:12:4", "lock:12"]);
    await h.shipper.flushAll();
    expect(eventKinds(h.central)).toEqual(["ack:60:expired", "ack:61:refused", "ack:62:refused", "ack:63:done", "ack:64:done"]);
    expect(h.central.received.locksEvents.find((r) => r.requestId === 63).generation).toBe(4);
  });

  /** group B's explicit unsigned-STOP envelope (edgeProtocol.edgeUnsignedStopSchema) */
  const US = (requestId: number, target: { robotId: number } | { adapterId: number }, ownerEpoch = 3) => ({ typ: "cmd-stop-unsigned", requestId, nodeId: 7, credentialId: 31, ownerEpoch, target });
  const acks = (c: FakeCentral) => c.received.locksEvents.filter((r) => r.kind === "command_ack");

  it("★ R-10-k/o/p: the explicit unsigned-STOP envelope (in `unsignedStops`) is executed and acked WITH the target stopped + owner epoch", async () => {
    const h = await harness({ claimRuns: false });
    h.central.handlers.pull = () => ({
      status: 200,
      data: {
        node: "edge-a", protocolVersion: 2, configVersion: 1, keysetVersion: 1, programCheckRequested: false, runs: [], claims: [], stopsUnconfirmed: [], commands: [],
        unsignedStops: [US(80, { robotId: 12 }), US(81, { adapterId: 21 }, 2)],
      },
    });
    const t = await h.agent.tick();
    expect(t.online).toBe(true);
    expect(h.devices.calls).toEqual(["stopRobot:12", "stopAdapter:21:config"]);
    expect(t.commands.map((c) => c.outcome)).toEqual(["unsigned:sent", "unsigned:sent"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((r) => [r.requestId, r.outcome, r.target, r.ownerEpoch, r.unsigned])).toEqual([
      [80, "done", { robotId: 12 }, 3, true],
      [81, "done", { adapterId: 21 }, 2, true],
    ]);
    expect(eventKinds(h.central).some((e) => e.startsWith("anomaly:"))).toBe(false); // unsigned on purpose is not tampering
  });

  it("★ R-10-o: a SIGNED ack carries the target and owner epoch too (and no unsigned mark)", async () => {
    const h = await harness({ claimRuns: false });
    await h.agent.handleCommands([h.central.sign("cmd", h.central.commandPayload({ requestId: 83, kind: "stop", target: { robotId: 12 } }))]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((r) => [r.requestId, r.target, r.ownerEpoch, r.unsigned])).toEqual([[83, { robotId: 12 }, 3, undefined]]);
  });

  it("★ R-10-p: {sig:\"\"}, a missing sig, alg none — executed as evidence only (requestId null + anomaly), NEVER acked", async () => {
    const h = await harness({ claimRuns: false });
    const env = (n: number) => h.central.sign("cmd", h.central.commandPayload({ requestId: n, kind: "stop", target: { robotId: 12 } }));
    const emptySig = { ...env(84), sig: "" };
    const { sig: _drop, ...noSig } = env(85);
    const algNone = { ...env(86), alg: "none" };
    const looseUnsigned = { unsigned: true, command: h.central.commandPayload({ requestId: 87, kind: "stop", target: { robotId: 12 } }) };
    const extraKey = { ...US(88, { robotId: 12 }), note: "x" };
    const otherNode = { ...US(89, { robotId: 12 }), nodeId: 8 };
    const r = await h.agent.handleCommands([emptySig, noSig, algNone, looseUnsigned, extraKey, otherNode]);
    expect(r.map((c) => [c.requestId, c.outcome])).toEqual([
      [null, "unverified:sent"],
      [null, "unverified:sent"],
      [null, "unverified:sent"],
      [null, "refused:bad_alg"],
      [null, "refused:bad_alg"],
      [null, "refused:bad_alg"],
    ]);
    expect(h.devices.calls).toEqual(["stopRobot:12", "stopRobot:12", "stopRobot:12"]);
    await h.shipper.flushAll();
    expect(acks(h.central)).toEqual([]);
    expect(eventKinds(h.central).filter((e) => e === "anomaly:EDGE_COMMAND_INVALID")).toHaveLength(6);
    expect(h.central.received.locksEvents.filter((x) => x.kind === "stop").every((x) => x.requestId === null && x.source === "anomaly")).toBe(true);
  });

  it("★ R-10-k: an unsigned lock / clear is refused (only a STOP acts without a valid signature)", async () => {
    const h = await harness({ claimRuns: false });
    const r = await h.agent.handleCommands([
      { ...US(90, { robotId: 12 }), typ: "cmd-clear-unsigned", expectedGeneration: 4 },
      { typ: "cmd-stop-unsigned", kind: "lock", requestId: 91, nodeId: 7, credentialId: 31, ownerEpoch: 3, robotId: 12 },
      { unsigned: true, command: h.central.commandPayload({ requestId: 92, kind: "clear", robotId: 12, expectedGeneration: 4, clearedBy: 9, reason: "x" }) },
    ]);
    expect(h.devices.calls).toEqual([]);
    expect(r.map((c) => c.outcome.startsWith("refused:"))).toEqual([true, true, true]);
    await h.shipper.flushAll();
    expect(acks(h.central)).toEqual([]);
  });

  it("★ R-10-k: an OVERDUE stop (past expiresAt) is executed, never discarded for its age; de-duplicated by requestId (per target)", async () => {
    const h = await harness({ claimRuns: false });
    const old = h.central.sign("cmd", h.central.commandPayload({ requestId: 95, kind: "stop", target: { robotId: 12 }, issuedAt: Date.now() - 3_600_000, expiresAt: Date.now() - 1_800_000 }));
    expect((await h.agent.handleCommands([old])).map((c) => c.outcome)).toEqual(["sent"]);
    // the same request again — signed, or as the unsigned envelope — runs once
    expect((await h.agent.handleCommands([old, US(95, { robotId: 12 })])).map((c) => c.outcome)).toEqual(["duplicate", "duplicate"]);
    // a forged copy under the same requestId for ANOTHER device can never suppress that device's genuine STOP
    const evil = generateEdgeSigningKey().key;
    await h.agent.handleCommands([h.central.sign("cmd", h.central.commandPayload({ requestId: 96, kind: "stop", target: { robotId: 12 } }), evil)]);
    expect((await h.agent.handleCommands([h.central.sign("cmd", h.central.commandPayload({ requestId: 96, kind: "stop", target: { adapterId: 21 } }))])).map((c) => c.outcome)).toEqual(["sent"]);
    expect(h.devices.calls).toEqual(["stopRobot:12", "stopRobot:12", "stopAdapter:21:config"]);
  });

  it("★ R-10-o: central REFUSES the ack ⇒ the STOP stays done locally (not re-sent), the ack is kept + retried; a STOP that FAILED is retried on re-delivery and never acked", async () => {
    const h = await harness({ claimRuns: false });
    h.central.handlers.locksEvents = () => ({ status: 409, code: "unauthorised_actuation" });
    const stop = h.central.sign("cmd", h.central.commandPayload({ requestId: 97, kind: "stop", target: { robotId: 12 } }));
    await h.agent.handleCommands([stop]);
    expect(await h.shipper.flush("events")).toBe("refused");
    expect(logs.join("\n")).toMatch(/ANOMALY: central refused the events stream/);
    expect(h.journal.pending("events").some((e) => kindOf(e.record) === "command_ack")).toBe(true);
    expect((await h.agent.handleCommands([stop])).map((c) => c.outcome)).toEqual(["duplicate"]);
    expect(h.devices.calls).toEqual(["stopRobot:12"]);
    // a STOP the device could not take: not remembered, not acked ⇒ the next delivery tries again
    let fail = true;
    h.devices.port.stopRobot = async () => (h.devices.calls.push("stopRobot:try"), fail ? { outcome: "failed" } : { outcome: "sent" });
    const s2 = h.central.sign("cmd", h.central.commandPayload({ requestId: 98, kind: "stop", target: { robotId: 12 } }));
    expect((await h.agent.handleCommands([s2])).map((c) => c.outcome)).toEqual(["failed"]);
    fail = false;
    expect((await h.agent.handleCommands([s2])).map((c) => c.outcome)).toEqual(["sent"]);
    delete h.central.handlers.locksEvents;
    await h.shipper.flushAll();
    expect(acks(h.central).map((r) => [r.requestId, r.outcome])).toEqual([[97, "done"], [97, "done"], [98, "done"]]); // 97 re-acked on its re-delivery
  });

  it("a re-delivered signed lock runs once; an UNSIGNED STOP the device could not take is retried on re-delivery and acked only once done", async () => {
    const h = await harness({ claimRuns: false });
    const lock = h.central.sign("cmd", h.central.commandPayload({ requestId: 99, kind: "lock", robotId: 12, reason: "x" }));
    expect((await h.agent.handleCommands([lock])).map((c) => c.outcome)).toEqual(["done"]);
    expect((await h.agent.handleCommands([lock])).map((c) => c.outcome)).toEqual(["duplicate"]);
    expect(h.devices.calls).toEqual(["lock:12"]);
    let fail = true;
    h.devices.port.stopRobot = async () => (h.devices.calls.push("stopRobot:try"), fail ? { outcome: "failed" } : { outcome: "sent" });
    const u = { typ: "cmd-stop-unsigned", requestId: 100, nodeId: 7, credentialId: 31, ownerEpoch: 3, target: { robotId: 12 } };
    expect((await h.agent.handleCommands([u])).map((c) => c.outcome)).toEqual(["unsigned:failed"]);
    fail = false;
    expect((await h.agent.handleCommands([u])).map((c) => c.outcome)).toEqual(["unsigned:sent"]);
    expect((await h.agent.handleCommands([u])).map((c) => c.outcome)).toEqual(["duplicate"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((r) => [r.requestId, r.outcome])).toEqual([[99, "done"], [100, "done"], [100, "done"]]); // the duplicate unsigned copy re-acks
  });

  it("★ fix review 2 (S-1, R-10-ar): an evidence-only (bad-signature) STOP never satisfies the signed copy — it RE-EXECUTES, then acks with the target, once", async () => {
    const h = await harness({ claimRuns: false });
    const evil = generateEdgeSigningKey().key;
    const payload = h.central.commandPayload({ requestId: 120, kind: "stop", target: { robotId: 12 } });
    expect((await h.agent.handleCommands([h.central.sign("cmd", payload, evil)])).map((c) => c.outcome)).toEqual(["unverified:sent"]);
    await h.shipper.flushAll();
    expect(acks(h.central)).toEqual([]); // evidence only — never acked from a bad signature
    const good = h.central.sign("cmd", payload);
    expect((await h.agent.handleCommands([good])).map((c) => c.outcome)).toEqual(["sent"]); // executed by THIS copy
    expect((await h.agent.handleCommands([good])).map((c) => c.outcome)).toEqual(["duplicate"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((r) => [r.requestId, r.outcome, r.target, r.ownerEpoch])).toEqual([
      [120, "done", { robotId: 12 }, 3],
      [120, "done", { robotId: 12 }, 3], // the duplicate signed copy re-acks (F-3)
    ]);
    expect(h.devices.calls).toEqual(["stopRobot:12", "stopRobot:12"]); // evidence run + the verified run
    // a pre-emption the other way round: the genuine copy fails at the device ⇒ no ack, retried; never "done" without a send
    let fail = true;
    h.devices.port.stopRobot = async () => (h.devices.calls.push("stopRobot:try"), fail ? { outcome: "failed" } : { outcome: "sent" });
    const p2 = h.central.commandPayload({ requestId: 121, kind: "stop", target: { robotId: 12 } });
    await h.agent.handleCommands([h.central.sign("cmd", p2, evil)]); // evidence attempt (fails)
    expect((await h.agent.handleCommands([h.central.sign("cmd", p2)])).map((c) => c.outcome)).toEqual(["failed"]);
    fail = false;
    expect((await h.agent.handleCommands([h.central.sign("cmd", p2)])).map((c) => c.outcome)).toEqual(["sent"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((r) => r.requestId)).toEqual([120, 120, 121]); // 120 re-acked once on its re-delivery
  });

  it("★ fix review 2 (S-2): a STOP for a robot assigned in the INCOMING config runs after the refresh and is acked — never refused while the refresh is pending", async () => {
    const h = await harness({ claimRuns: false });
    const base = h.central.makeConfig();
    h.central.setConfig({ robots: [...base.robots, { ...base.robots[0], id: 13, code: "rb-13" }] }); // newer config pending
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 150, kind: "stop", target: { robotId: 13 } }))];
    const r = await h.agent.tick();
    expect(r.commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "sent"]); // fast path deferred, work phase ran it
    expect(h.devices.calls).toEqual(["stopRobot:13"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((x) => [x.requestId, x.outcome, x.target])).toEqual([[150, "done", { robotId: 13 }]]);
  });

  it("★ fix review 2 (S-2): the refresh FAILS ⇒ the STOP stays pending (no ack), the next pull retries it", async () => {
    const h = await harness({ claimRuns: false });
    const base = h.central.makeConfig();
    h.central.setConfig({ robots: [...base.robots, { ...base.robots[0], id: 13, code: "rb-13" }] });
    h.central.handlers.config = () => "network";
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 151, kind: "stop", target: { robotId: 13 } }))];
    const r1 = await h.agent.tick();
    expect(r1.commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "pending:not_yet_known"]);
    await h.shipper.flushAll();
    expect(acks(h.central)).toEqual([]);
    delete h.central.handlers.config;
    const r2 = await h.agent.tick();
    expect(r2.commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "sent"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((x) => [x.requestId, x.outcome])).toEqual([[151, "done"]]);
  });

  it("★ fix review 3 (F-1): a VERIFIED refresh of this cycle still omits the device ⇒ ack `notOwnedHere` (never `refused`)", async () => {
    const h = await harness({ claimRuns: false });
    h.central.setConfig({}); // newer, still without robot 998
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 153, kind: "stop", target: { robotId: 998 } }))];
    const r = await h.agent.tick();
    expect(r.commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "notOwnedHere"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((x) => [x.requestId, x.outcome, x.target])).toEqual([[153, "notOwnedHere", { robotId: 998 }]]);
  });

  it("★ fix review 2 (N-4): a pull stuck on a STOP that never settles does not hold the next pull's STOPs (bounded single-flight)", async () => {
    const h = await harness({ claimRuns: false, requestTimeoutMs: 100 });
    h.devices.port.stopRobot = async () => new Promise<never>(() => undefined); // the robot STOP hangs forever
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 160, kind: "stop", target: { robotId: 12 } }))];
    void h.agent.tick();
    await new Promise((r) => setTimeout(r, 1_400)); // past the bound (2 × 100 ms + 1 s)
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 161, kind: "stop", target: { adapterId: 21 } }))];
    const r2 = await h.agent.tick();
    expect(r2.commands.map((c) => [c.requestId, c.outcome])).toEqual([[161, "sent"]]);
  });

  it("★ fix review 3 (F-1): the answer's version says nothing is pending (a CACHED version) — an unknown target still FORCES a refresh; never `refused`", async () => {
    const h = await harness({ claimRuns: false });
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 152, kind: "stop", target: { robotId: 999 } }))];
    const configsBefore = h.central.callsTo("config").length;
    const r = await h.agent.tick();
    expect(h.central.callsTo("config").length).toBe(configsBefore + 1); // forced, although the pull's configVersion is not newer
    expect(r.commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "notOwnedHere"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((x) => [x.requestId, x.outcome, x.target])).toEqual([[152, "notOwnedHere", { robotId: 999 }]]);
    expect(acks(h.central).some((x) => x.outcome === "refused")).toBe(false);
  });

  it("★ fix review 3 (F-1): central owner change lags the edge's config (cached version) — the STOP for the NEW robot runs after the forced refresh", async () => {
    const h = await harness({ claimRuns: false });
    const base = h.central.makeConfig();
    const v = h.central.configVersion;
    h.central.setConfig({ robots: [...base.robots, { ...base.robots[0], id: 13, code: "rb-13" }] });
    h.central.handlers.pull = () => ({
      status: 200,
      data: { node: "edge-a", protocolVersion: 2, configVersion: v, keysetVersion: 1, programCheckRequested: false, runs: [], claims: [], stopsUnconfirmed: [], commands: [h.central.sign("cmd", h.central.commandPayload({ requestId: 154, kind: "stop", target: { robotId: 13 } }))] },
    }); // the pull still reports the OLD (cached) version
    const r = await h.agent.tick();
    expect(r.commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "sent"]);
    expect(h.devices.calls).toEqual(["stopRobot:13"]);
  });

  it("★ fix review 3 (F-1): refresh keeps failing ⇒ the STOP stays pending (no ack) and an edge alert is raised after the bound", async () => {
    let now = 1_000_000;
    const h = await harness({ claimRuns: false });
    (h.agent as unknown as { cfg: { now: () => number } }).cfg.now = () => now;
    h.central.handlers.config = () => "network";
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 155, kind: "stop", target: { robotId: 997 } }))];
    await h.agent.tick();
    now += 31_000;
    const r = await h.agent.tick();
    expect(r.commands.every((c) => c.outcome.includes("pending:"))).toBe(true);
    await h.shipper.flushAll();
    expect(acks(h.central)).toEqual([]);
    expect(eventKinds(h.central)).toContain("anomaly:EDGE_STOP_TARGET_UNKNOWN");
  });

  it("★ fix review 3: a `clear` against a STALE config waits for the refresh (never applied before it)", async () => {
    const h = await harness({ claimRuns: false });
    h.central.setConfig({});
    h.central.handlers.config = () => "network"; // the newer config cannot be fetched
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 156, kind: "clear", robotId: 12, expectedGeneration: 4, clearedBy: 9, reason: "x" }))];
    const r = await h.agent.tick();
    expect(r.commands.map((c) => c.outcome)).toEqual(["pending:stale_config"]);
    expect(h.devices.calls).toEqual([]);
    delete h.central.handlers.config;
    const r2 = await h.agent.tick();
    expect(r2.commands.map((c) => c.outcome)).toEqual(["done"]);
  });

  it("★ fix review 3/4 (F-3, M-3): an UNSIGNED execution never dedupes the signed copy; re-acks follow a TIME back-off (never the re-delivery count), one anomaly after the cap, then every 5 min; memories pruned by age", async () => {
    let now = 1_000_000;
    const h = await harness({ claimRuns: false });
    (h.agent as unknown as { cfg: { now: () => number } }).cfg.now = () => now;
    const u = { typ: "cmd-stop-unsigned", requestId: 170, nodeId: 7, credentialId: 31, ownerEpoch: 3, target: { robotId: 12 } };
    expect((await h.agent.handleCommands([u])).map((c) => c.outcome)).toEqual(["unsigned:sent"]);
    const signed = h.central.sign("cmd", h.central.commandPayload({ requestId: 170, kind: "stop", target: { robotId: 12 } }));
    expect((await h.agent.handleCommands([signed])).map((c) => c.outcome)).toEqual(["sent"]); // executed by the verified copy
    expect(h.devices.calls).toEqual(["stopRobot:12", "stopRobot:12"]);
    const reacks = async () => {
      await h.shipper.flushAll();
      return acks(h.central).filter((x) => x.requestId === 170).length - 2; // minus the unsigned ack + the signed ack
    };
    // a burst of 12 re-deliveries at the same instant: ONE re-ack (M-3 — the cadence of pulls never consumes the budget)
    for (let i = 0; i < 12; i++) await h.agent.handleCommands([signed]);
    expect(await reacks()).toBe(1);
    expect(eventKinds(h.central)).not.toContain("anomaly:EDGE_STOP_ACK_UNCONFIRMED");
    // the back-off: 2 s after the first re-ack (not 1 999 ms), then 4 s …
    now += 1_999;
    await h.agent.handleCommands([signed]);
    expect(await reacks()).toBe(1);
    now += 1;
    await h.agent.handleCommands([signed]);
    expect(await reacks()).toBe(2);
    now += 3_999;
    await h.agent.handleCommands([signed]);
    expect(await reacks()).toBe(2);
    now += 1;
    await h.agent.handleCommands([signed]);
    expect(await reacks()).toBe(3);
    // central keeps losing / refusing the ack: past the cap ONE anomaly, and the re-acks go on at most every 5 min
    for (let i = 0; i < 12; i++) {
      now += 300_000;
      await h.agent.handleCommands([signed]);
      await h.agent.handleCommands([signed]); // a re-delivery in the same instant: rate-limited
    }
    expect(await reacks()).toBe(15);
    expect(eventKinds(h.central).filter((e) => e === "anomaly:EDGE_STOP_ACK_UNCONFIRMED")).toHaveLength(1);
    expect(h.devices.calls).toHaveLength(2);
    // a STOP that stopped arriving: its memory is dropped after an hour (bounded), at the next pull
    const mem = h.agent as unknown as { reacks: Map<string, unknown>; notOwnedSent: Map<string, unknown> };
    expect(mem.reacks.size).toBe(1);
    now += 3_600_001;
    await h.agent.tick();
    expect(mem.reacks.size).toBe(0);
  });

  it("★ fix review 4 (M-2): notOwnedHere is rate-limited per STOP request (one answer a minute), one alert", async () => {
    let now = 1_000_000;
    const h = await harness({ claimRuns: false });
    (h.agent as unknown as { cfg: { now: () => number } }).cfg.now = () => now;
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 180, kind: "stop", target: { robotId: 996 } }))];
    expect((await h.agent.tick()).commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "notOwnedHere"]);
    now += 59_999;
    expect((await h.agent.tick()).commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "notOwnedHere:rate_limited"]);
    now += 1;
    expect((await h.agent.tick()).commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "notOwnedHere"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((x) => [x.requestId, x.outcome])).toEqual([[180, "notOwnedHere"], [180, "notOwnedHere"]]);
    expect(eventKinds(h.central).filter((e) => e === "anomaly:EDGE_STOP_NOT_OWNED_HERE")).toHaveLength(1);
    expect(h.devices.calls).toEqual([]);
  });

  it("★ fix review 5 (nit): the notOwnedHere rate limit starts only once the ack is JOURNALED — a failed append is answered again on the next delivery", async () => {
    let now = 1_000_000;
    const h = await harness({ claimRuns: false });
    (h.agent as unknown as { cfg: { now: () => number } }).cfg.now = () => now;
    const sink = (h.agent as unknown as { deps: { sink: { event: (r: { kind: string }, o?: unknown) => Promise<{ seq: number | null }> } } }).deps.sink;
    const real = sink.event.bind(sink);
    let failAck = true;
    sink.event = async (r, o) => (failAck && r.kind === "command_ack" ? Promise.reject(new Error("journal append failed")) : real(r, o));
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 185, kind: "stop", target: { robotId: 995 } }))];
    expect((await h.agent.tick()).commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "notOwnedHere:ack_not_journaled"]);
    failAck = false;
    now += 1_000; // well inside the 60 s window
    expect((await h.agent.tick()).commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "notOwnedHere"]);
    now += 1_000;
    expect((await h.agent.tick()).commands.map((c) => c.outcome)).toEqual(["pending:not_yet_known", "notOwnedHere:rate_limited"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((x) => [x.requestId, x.outcome])).toEqual([[185, "notOwnedHere"]]);
  });

  it("★ fix review 4 (F-2 leftover): an OWNED device with no session on this edge ⇒ its STOP is answered notOwnedHere at once (central's fallback runs it)", async () => {
    const h = await harness({ claimRuns: false });
    let attached = false;
    (h.agent as unknown as { deps: { hasSession: (t: { robotId: number } | { adapterId: number }) => boolean } }).deps.hasSession = (t) => !("robotId" in t) || attached;
    const s1 = h.central.sign("cmd", h.central.commandPayload({ requestId: 190, kind: "stop", target: { robotId: 12 } }));
    expect((await h.agent.handleCommands([s1])).map((c) => c.outcome)).toEqual(["notOwnedHere"]); // no pending, no refresh needed
    expect(h.devices.calls).toEqual([]);
    attached = true;
    const s2 = h.central.sign("cmd", h.central.commandPayload({ requestId: 191, kind: "stop", target: { robotId: 12 } }));
    expect((await h.agent.handleCommands([s2])).map((c) => c.outcome)).toEqual(["sent"]);
    const s3 = h.central.sign("cmd", h.central.commandPayload({ requestId: 192, kind: "stop", target: { adapterId: 21 } }));
    expect((await h.agent.handleCommands([s3])).map((c) => c.outcome)).toEqual(["sent"]);
    await h.shipper.flushAll();
    expect(acks(h.central).map((x) => [x.requestId, x.outcome, x.target])).toEqual([
      [190, "notOwnedHere", { robotId: 12 }],
      [191, "done", { robotId: 12 }],
      [192, "done", { adapterId: 21 }],
    ]);
  });

  it("★ fix review 4 (M-1): an OLDER pull's refresh finishing during a newer pull's STOPs never makes a target \"not ours\" — refresh state is per pull", async () => {
    const h = await harness({ claimRuns: false });
    const base = h.central.makeConfig();
    h.central.setConfig({}); // newer ⇒ pull A's work phase refreshes …
    let releaseCfg!: () => void;
    const gate = new Promise<void>((r) => (releaseCfg = r));
    const kit = h.central as unknown as { defaults: (route: string, body: unknown, runId?: number) => unknown };
    h.central.handlers.config = async (body) => {
      const old = kit.defaults("config", body); // … with the config of THAT moment (robot 13 not in it)
      await gate;
      return old as never;
    };
    const configCalls = h.central.callsTo("config").length;
    const tickA = h.agent.tick();
    await vi.waitFor(() => expect(h.central.callsTo("config").length).toBe(configCalls + 1), { timeout: 2_000, interval: 5 });
    // robot 13 is assigned meanwhile; pull B carries a STOP for robot 12 (owned) THEN one for robot 13
    h.central.setConfig({ robots: [...base.robots, { ...base.robots[0], id: 13, code: "rb-13" }] });
    h.central.commands = [
      h.central.sign("cmd", h.central.commandPayload({ requestId: 200, kind: "stop", target: { robotId: 12 } })),
      h.central.sign("cmd", h.central.commandPayload({ requestId: 201, kind: "stop", target: { robotId: 13 } })),
    ];
    h.devices.port.stopRobot = async (id) => {
      h.devices.calls.push(`stopRobot:${id}`);
      if (id === 12) {
        releaseCfg(); // pull A's refresh (without robot 13) completes WHILE pull B handles its STOPs
        await new Promise((r) => setTimeout(r, 50));
      }
      return { outcome: "sent" };
    };
    delete h.central.handlers.config;
    const rB = await h.agent.tick();
    await tickA;
    const b = rB.commands.filter((c) => c.requestId === 201).map((c) => c.outcome);
    expect(b[0]).toBe("pending:not_yet_known"); // never notOwnedHere on the strength of pull A's refresh
    expect(b).not.toContain("notOwnedHere");
    await h.agent.tick(); // B's / the next refresh brings robot 13 ⇒ executed
    await vi.waitFor(() => expect(h.devices.calls).toContain("stopRobot:13"), { timeout: 2_000, interval: 5 });
    await h.shipper.flushAll();
    const a201 = acks(h.central).filter((x) => x.requestId === 201).map((x) => x.outcome);
    expect(a201[0]).toBe("done"); // (re-acked "done" on its re-delivery — never notOwnedHere)
    expect(new Set(a201)).toEqual(new Set(["done"]));
  });

  it("★ fix review 1 (I-4, L-7): a STOP in the pull runs BEFORE the config refresh — a hanging refresh / work phase never delays it, nor the next pull's STOPs", async () => {
    const h = await harness({ claimRuns: false });
    h.central.setConfig({}); // a newer config ⇒ the work phase refreshes …
    h.central.handlers.config = () => new Promise<never>(() => undefined); // … and that refresh HANGS (the fake ignores the timeout)
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 130, kind: "stop", target: { robotId: 12 } }))];
    const t0 = Date.now();
    void h.agent.tick();
    await vi.waitFor(() => expect(h.devices.calls).toEqual(["stopRobot:12"]), { timeout: 1_000, interval: 5 });
    expect(Date.now() - t0).toBeLessThan(1_000);
    // the first pull is over (its single-flight released — a fixed sleep raced it under full-suite load, so the second tick
    // JOINED pull 1 and reported 130); its work phase hangs on the refresh
    await vi.waitFor(() => expect((h.agent as unknown as { pulling: unknown }).pulling).toBeNull(), { timeout: 2_000, interval: 5 });
    // a second pull while the first work phase still hangs: its STOP goes too
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 131, kind: "stop", target: { adapterId: 21 } }))];
    const t1 = Date.now();
    const r2 = await h.agent.tick();
    expect(Date.now() - t1).toBeLessThan(1_000);
    expect(r2.commands.map((c) => [c.requestId, c.outcome])).toEqual([[131, "sent"]]);
    expect(h.devices.calls).toEqual(["stopRobot:12", "stopAdapter:21:config"]);
  });

  it("commands piggybacked on a progress answer are handled too (D10)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = fakeWalker({ hold: () => gate });
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    h.central.progressCommands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 70, kind: "stop", target: { robotId: 12 } }))];
    await vi.waitFor(() => expect(h.devices.calls).toEqual(["stopRobot:12"]), { timeout: 2_000 });
    release();
    await h.agent.idle();
  });
});

describe("doc 81 Đợt 10 E fix review 3 — INVARIANT: no STOP is ever acked `refused` (R-10-au)", () => {
  it("★ across every STOP path (signed / unsigned / overdue / duplicate / unknown target, refresh failing then succeeding / after a verified refresh / stale owner epoch / evidence / device failure) every STOP ack is done | failed | notOwnedHere", async () => {
    const h = await harness({ claimRuns: false });
    const acks = (c: FakeCentral) => c.received.locksEvents.filter((r) => r.kind === "command_ack");
    const evil = generateEdgeSigningKey().key;
    const stopIds = new Set<number>();
    const signed = (requestId: number, target: { robotId: number } | { adapterId: number }, over: Record<string, unknown> = {}) => {
      stopIds.add(requestId);
      return h.central.sign("cmd", h.central.commandPayload({ requestId, kind: "stop", target, ...over }));
    };
    const unsigned = (requestId: number, target: { robotId: number } | { adapterId: number }) => {
      stopIds.add(requestId);
      return { typ: "cmd-stop-unsigned", requestId, nodeId: 7, credentialId: 31, ownerEpoch: 3, target };
    };
    // signed owned + duplicate (re-ack), adapter, overdue, stale owner epoch
    await h.agent.handleCommands([signed(200, { robotId: 12 })]);
    await h.agent.handleCommands([signed(200, { robotId: 12 })]);
    await h.agent.handleCommands([signed(201, { adapterId: 21 })]);
    await h.agent.handleCommands([signed(202, { robotId: 12 }, { issuedAt: Date.now() - 3_600_000, expiresAt: Date.now() - 1_800_000 })]);
    await h.agent.handleCommands([signed(203, { robotId: 12 }, { ownerEpoch: 1 })]);
    // unsigned owned + its signed copy; evidence (bad signature) — never acked
    await h.agent.handleCommands([unsigned(204, { robotId: 12 })]);
    await h.agent.handleCommands([signed(204, { robotId: 12 })]);
    stopIds.add(205);
    await h.agent.handleCommands([h.central.sign("cmd", h.central.commandPayload({ requestId: 205, kind: "stop", target: { robotId: 12 } }), evil)]);
    // a device failure (not acked), then success
    const orig = h.devices.port.stopRobot;
    h.devices.port.stopRobot = async () => ({ outcome: "failed" });
    await h.agent.handleCommands([signed(206, { robotId: 12 })]);
    h.devices.port.stopRobot = orig;
    await h.agent.handleCommands([signed(206, { robotId: 12 })]);
    // unknown targets through full pulls: refresh failing, then succeeding (still unknown ⇒ notOwnedHere), unsigned too
    h.central.handlers.config = () => "network";
    h.central.commands = [signed(207, { robotId: 990 }), signed(208, { adapterId: 991 })];
    await h.agent.tick();
    await h.agent.tick();
    delete h.central.handlers.config;
    await h.agent.tick();
    h.central.commands = [];
    await h.agent.handleCommands([unsigned(209, { robotId: 992 })]);
    await h.shipper.flushAll();
    const stopAcks = acks(h.central).filter((a) => stopIds.has(a.requestId));
    expect(stopAcks.length).toBeGreaterThan(8); // instrument check: the paths above did ack
    expect(new Set(stopAcks.map((a) => a.outcome))).toEqual(new Set(["done", "notOwnedHere"]));
    expect(stopAcks.every((a) => ["done", "failed", "notOwnedHere"].includes(a.outcome))).toBe(true);
    expect(stopAcks.some((a) => a.outcome === "refused")).toBe(false);
    expect(stopAcks.some((a) => a.requestId === 205)).toBe(false); // evidence is never acked
  });
});

describe("doc 81 Đợt 10 E — agent v2: STOP re-send from the sweep picture (L-7)", () => {
  it("★ verified picture: every STOP not confirmed before is re-sent (OT with the picture's pins), at most once per interval", async () => {
    const h = await harness({ claimRuns: false });
    h.central.stopsUnconfirmed = [{ runId: 33, picture: h.central.sign("runpkg", h.central.sweepPicture(33)) }];
    expect((await h.agent.tick()).stopsResent).toEqual([33]);
    expect(h.devices.calls).toEqual(["stopRobot:12", 'stopAdapter:21:[{"tagKey":"run","value":false}]']);
    expect((await h.agent.tick()).stopsResent).toEqual([]);
    expect(h.devices.calls).toHaveLength(2);
  });

  it("★ fix review 6 (R-10-bn, F1-4): a re-sent STOP is reported BOUND to its verified picture (run, step, target, owner epoch); re-sends back off 1 s → 30 s, and stop once central confirms (the run leaves stopsUnconfirmed)", async () => {
    let now = 1_000_000;
    const h = await harness({ claimRuns: false });
    (h.agent as unknown as { cfg: { now: () => number; stopResendMinMs: number } }).cfg.now = () => now;
    (h.agent as unknown as { cfg: { stopResendMinMs: number } }).cfg.stopResendMinMs = 1_000;
    const pic = h.central.sweepPicture(35);
    h.central.stopsUnconfirmed = [{ runId: 35, picture: h.central.sign("runpkg", pic) }];
    expect((await h.agent.tick()).stopsResent).toEqual([35]);
    await h.shipper.flushAll();
    const bound = h.central.received.locksEvents.filter((r) => r.kind === "sweep_stop");
    expect(bound.map((r) => [r.runId, r.stepId, r.target, r.ownerEpoch, r.pictureIssuedAt, r.status])).toEqual([
      [35, "s-r", { robotId: 12 }, 3, pic.issuedAt, "completed"],
      [35, "s-o", { adapterId: 21 }, 2, pic.issuedAt, "completed"],
    ]);
    // the back-off: 1 s, 2 s, 4 s … capped at 30 s (never every pull)
    const resendsAt: number[] = [];
    for (let t = 0; t < 200; t++) {
      now += 500;
      if ((await h.agent.tick()).stopsResent.length) resendsAt.push(t);
    }
    const gaps = resendsAt.slice(1).map((x, i) => (x - resendsAt[i]) * 500);
    expect(resendsAt[0]).toBe(1); // first re-send 1 s after the first
    expect(gaps.slice(0, 4)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(gaps.length).toBeGreaterThanOrEqual(6);
    expect(gaps.slice(4).every((g) => g === 30_000)).toBe(true);
    // central confirms ⇒ the run is no longer listed ⇒ never re-sent again (and its back-off state is dropped)
    const calls = h.devices.calls.length;
    h.central.stopsUnconfirmed = [];
    for (let t = 0; t < 70; t++) {
      now += 500;
      expect((await h.agent.tick()).stopsResent).toEqual([]);
    }
    expect(h.devices.calls).toHaveLength(calls);
    expect((h.agent as unknown as { resentAt: Map<number, unknown> }).resentAt.size).toBe(0);
  });

  it("★ a FORGED picture still STOPs owned devices — OT with the verified CONFIG's pins, never the message's; anomaly", async () => {
    const h = await harness({ claimRuns: false });
    const evil = generateEdgeSigningKey().key;
    const pic = h.central.sweepPicture(34, {
      verifiedStops: [
        { kind: "ot", stepId: "x", adapterId: 21, pins: [{ tagKey: "run", value: true }] },
        { kind: "robot", stepId: "y", robotId: 777 },
      ],
    });
    h.central.stopsUnconfirmed = [{ runId: 34, picture: h.central.sign("runpkg", pic, evil) }];
    await h.agent.tick();
    expect(h.devices.calls).toEqual(["stopAdapter:21:config"]);
    await h.shipper.flushAll();
    expect(eventKinds(h.central)).toContain("anomaly:EDGE_SWEEP_PICTURE_INVALID");
    expect(eventKinds(h.central)).not.toContain("sweep_stop"); // R-10-bn — a forged picture's re-send is never offered for confirmation
  });
});

// DO-66 vòng 4 (17/11) — lô X-12 commit 1 (chỉ test), theo cách (1) HST trình: nút nhớ theo ĐÍCH, qua các lượt pull, STOP nó đã chạy THÀNH CÔNG
// (bản ký hoặc bản không ký tường minh; bản bằng chứng không tính — HST (b)), kèm phép so ghim; ảnh kiểm được chữ ký mới được bỏ qua bước.
// Kỳ vọng theo đặc tả (hàng X-12, bất biến STOP 16/11, "không biết" = cái biết của bên quyết định gửi; vòng 3: TỔNG lần tới driver = 1 qua cả
// cửa sổ), không theo mã hiện tại. Ca hành vi mong muốn: it.fails ở commit 1 (đỏ trước sửa), it từ commit 2 (X-12); ca phủ / đối chứng: it, xanh trước và sau sửa.
// Vòng 4 (HST: lệch giờ không được là giới hạn): "STOP chạy SAU lúc huỷ" được chứng minh theo THỨ TỰ, không theo giờ — lời gọi driver của STOP bắt
// đầu sau khi nút đã NHẬN một phản hồi pull liệt run kèm ảnh kiểm được chữ ký. Các ca lệch giờ đặt đồng hồ nút ±10 phút: kết quả không đổi.
describe("X-12 — the node never re-sends from a sweep picture a STOP it already knows went out (edge half of the A2(n) gate)", () => {
  /** the OT STOP of step s9 on the node's adapter 21, with the step's pin (the fake config pins `run` = false) */
  const S9 = { kind: "ot" as const, stepId: "s9", adapterId: 21, pins: [{ tagKey: "run", value: false }] };
  const S9_DRIVER = 'stopAdapter:21:[{"tagKey":"run","value":false}]';
  const S8_ROBOT = { kind: "robot" as const, stepId: "s8", robotId: 12 };
  const CUA_SO_MS = 15 * 60_000;
  const prior0 = { completed: [] as string[], settled: [] as string[], attempted: [] as string[], startOrder: [] as string[], branches: [], abortSentBefore: [] as string[], unknown: false };
  type H = Awaited<ReturnType<typeof harness>>;
  /** a sweep picture of run `runId` (its walker gone: no segment here), naming s9 unconfirmed; aborted `abortedAt` (default 5 s ago) */
  const anh = (h: H, runId: number, over: Parameters<FakeCentral["sweepPicture"]>[1] = {}) =>
    h.central.sweepPicture(runId, { verifiedStops: [S9], prior: { ...prior0 }, abortedAt: Date.now() - 5_000, issuedAt: Date.now() - 100, ...over });
  const toiAdapter21 = (h: H) => h.devices.calls.filter((c) => c.startsWith("stopAdapter:21:"));
  type AnhKy = Parameters<NonNullable<EdgeWalker["resendStops"]>>[0];
  /** central's time `d.now`, driven by the case; the node's clock (cfg.now) is central's time + `lech` (a node clock fast / slow) */
  function dongHo(h: H, lech = 0) {
    const d = { now: Date.now() };
    (h.agent as unknown as { cfg: { now: () => number } }).cfg.now = () => d.now + lech;
    return d;
  }
  /**
   * the device port as edgeDispatchDevicePort answers a STOP with the CONFIG's pins (pins null, edgeExecutionAgent.ts:1271-1277): `sent` with
   * `written` = the pins it wrote (the fake config pins `run` = false). `sua` changes the answer of the n-th such call (1-based).
   */
  function congCoWritten(h: H, sua: (n: number) => Partial<{ outcome: "sent" | "failed" | "simulated"; written: Array<{ tagKey: string; value: unknown }> | undefined }> = () => ({})) {
    const goc = h.devices.port.stopAdapter;
    let n = 0;
    h.devices.port.stopAdapter = async (id, pins, why, ctx) => {
      const r = await goc(id, pins, why, ctx);
      if (pins !== null) return r;
      n++;
      const o = { outcome: "sent" as const, written: [{ tagKey: "run", value: false }], ...sua(n) };
      // a variable, not a literal: `written` is the port's answer AFTER the X-12 fix (EdgeStopOutcome has no such field before it)
      const ra = o.written ? { ...r, outcome: o.outcome, written: o.written } : { ...r, outcome: o.outcome };
      return ra;
    };
  }
  /**
   * the walker's (engine) STOP re-send, modelled on its contract only: a step in prior.abortSentBefore ("never sent again",
   * edgeProtocol.ts:272; foeEngine.ts:6146) or prior.settled (edgeRunStore.ts:809/816; foeEngine.ts:6161) is skipped; every other verified
   * STOP goes to the node's device port, its outcome bound to the picture as a `sweep_stop` (edgeExecutionAgent.ts:1224-1236). The real
   * engine (foeEngine.resendStopsOfAbortedRun) is not loaded here.
   */
  function walkerMay() {
    const w = { pictures: [] as AnhKy[], port: null as EdgeDevicePort | null, walker: null as unknown as EdgeWalker };
    w.walker = {
      drive: async () => ({ outcome: "completed" }),
      abortLive: async () => ({ live: false }),
      resendStops: async (picture, sink, ownerEpochOf) => {
        w.pictures.push(picture);
        const bo = new Set([...picture.prior.abortSentBefore, ...picture.prior.settled]);
        let sent = 0;
        for (const s of picture.verifiedStops) {
          if (bo.has(s.stepId)) continue;
          const ctx = { source: "local" as const, requestId: null };
          const target = s.kind === "ot" ? { adapterId: s.adapterId } : { robotId: s.robotId };
          const r = s.kind === "ot" ? await w.port!.stopAdapter(s.adapterId, s.pins, `engine sweep ${s.stepId}`, ctx) : await w.port!.stopRobot(s.robotId, `engine sweep ${s.stepId}`, ctx);
          const ep = ownerEpochOf?.(target) ?? null;
          if (ep !== null) await sink.event({ kind: "sweep_stop", runId: picture.runId, stepId: s.stepId, target, ownerEpoch: ep, pictureIssuedAt: picture.issuedAt, status: r.outcome === "failed" ? "failed" : "completed", at: Date.now() }, { stop: true });
          sent++;
        }
        return { sent, failed: 0 };
      },
    };
    return w;
  }
  /** a SIGNED STOP request central queued for the node (the routed STOP of the same Abort), on `target` */
  const stopDaXep = (h: H, requestId: number, target: { robotId: number } | { adapterId: number }) =>
    h.central.sign("cmd", h.central.commandPayload({ requestId, kind: "stop", target }));
  /**
   * central, modelled: a run leaves stopsUnconfirmed once a non-failed `sweep_stop` of it arrived, or once its window (15 min from its abort)
   * is over; delivered STOP requests are acked (not re-delivered). The node pulls at each back-off step (10 s, 20 s, then 30 s) until no run
   * is listed (at most `max` pulls).
   */
  async function quaCuaSo(h: H, d: { now: number }, abortedAt: Map<number, number>, max = 80) {
    for (let i = 0; i < max && h.central.stopsUnconfirmed.length > 0; i++) {
      await h.agent.tick();
      await h.shipper.flushAll();
      h.central.commands = [];
      const xacNhan = new Set(h.central.received.locksEvents.filter((r) => r.kind === "sweep_stop" && r.status !== "failed").map((r) => r.runId));
      d.now += i === 0 ? 10_500 : i === 1 ? 20_500 : 30_500;
      h.central.stopsUnconfirmed = h.central.stopsUnconfirmed.filter((s) => !xacNhan.has(s.runId) && d.now - (abortedAt.get(s.runId) ?? 0) <= CUA_SO_MS);
    }
    expect(h.central.stopsUnconfirmed, "every run left the list (confirmed or window over)").toEqual([]);
  }

  it("X12-ANH-KY-GUI-MOT-LAN (phủ, đường dự phòng) a signed picture names s9 unconfirmed, no walker re-send ⇒ s9 reaches the node's driver exactly once (step pins), bound to the picture; the back-off sends nothing more", async () => {
    const h = await harness({ claimRuns: false });
    const pic = anh(h, 40);
    h.central.stopsUnconfirmed = [{ runId: 40, picture: h.central.sign("runpkg", pic) }];
    expect((await h.agent.tick()).stopsResent).toEqual([40]);
    expect((await h.agent.tick()).stopsResent, "back-off: not again in the next pull").toEqual([]);
    expect(h.devices.calls).toEqual([S9_DRIVER]);
    await h.shipper.flushAll();
    const bound = h.central.received.locksEvents.filter((r) => r.kind === "sweep_stop");
    expect(bound.map((r) => [r.runId, r.stepId, r.target, r.ownerEpoch, r.pictureIssuedAt, r.status])).toEqual([[40, "s9", { adapterId: 21 }, 2, pic.issuedAt, "completed"]]);
  });

  it("X12-ANH-KY-GUI-MOT-LAN-MAY (phủ, đường máy) a signed picture names s9 unconfirmed, the walker re-sends ⇒ the engine gets the picture once with s9 not marked sent; s9 reaches the driver exactly once; the device-port fallback adds nothing", async () => {
    const wm = walkerMay();
    const h = await harness({ claimRuns: false, walker: wm.walker });
    wm.port = h.devices.port;
    h.central.stopsUnconfirmed = [{ runId: 41, picture: h.central.sign("runpkg", anh(h, 41)) }];
    expect((await h.agent.tick()).stopsResent).toEqual([41]);
    expect((await h.agent.tick()).stopsResent).toEqual([]);
    expect(wm.pictures).toHaveLength(1);
    expect(wm.pictures[0].prior.abortSentBefore).not.toContain("s9");
    expect(h.devices.calls).toEqual([S9_DRIVER]);
  });

  // HST 17/11, X-12 bỏ vế (1), hướng đóng: gửi thừa một STOP đã completed thật trên đường dự phòng là chấp nhận; bộ lọc X-11 ở trung tâm chặn phần lớn
  // trước khi tới nút (edgeExecutionCentral.ts docRunAbortCanGuiLaiStop). Tên cũ: X12-DU-PHONG-BO-COMPLETED (kỳ vọng cũ: s9 không gửi) ⇒ tên mới dưới đây
  // đỏ trước sửa; đổi thành it ở commit 6 (X-12)
  it.fails("X12-DU-PHONG-COMPLETED-VAN-GUI (1, bỏ) device-port fallback, signed picture: s9 has its own row completed (prior.completed, attempted) ⇒ the fallback does not skip by prior.completed (the picture carries no per-row outcome): s9 is re-sent exactly once, s8 too", async () => {
    const h = await harness({ claimRuns: false });
    const pic = anh(h, 42, { verifiedStops: [S8_ROBOT, S9], prior: { ...prior0, completed: ["s9"], settled: ["s9"], attempted: ["s9"], startOrder: ["s9"] } });
    h.central.stopsUnconfirmed = [{ runId: 42, picture: h.central.sign("runpkg", pic) }];
    expect((await h.agent.tick()).stopsResent).toEqual([42]);
    expect((await h.agent.tick()).stopsResent, "back-off: not again in the next pull").toEqual([]);
    expect(h.devices.calls).toEqual(["stopRobot:12", S9_DRIVER]);
  });

  // HST 17/11 (DO-66 vòng 8, giới hạn đã nêu): re-walk — lần trước đã giao s9 cho dispatcher (resultJson.routedTo), lần sau precondition sai ⇒ hàng 'skipped'
  // (foeEngine.ts:1071-1077) giữ resultJson cũ (foeRunStore.ts:1184-1186): completed VÀ attempted đều có s9 — lần giao trước có thể đã hỏng: vẫn phải gửi lại
  // đỏ trước sửa; đổi thành it ở commit 6 (X-12)
  it.fails("X12-DU-PHONG-SKIPPED-ROUTED-VAN-GUI (1-đối chứng) device-port fallback, signed picture: s9's own row 'skipped' but still carrying the routedTo of an earlier hand-over — edgePriorPictureOf lists it in `completed` AND `attempted` ⇒ s9 is still re-sent, once", async () => {
    const { edgePriorPictureOf } = await import("../orchestration/foe/foeRunStore");
    const prior = edgePriorPictureOf([{ stepId: "s9", status: "skipped", resultJson: { routedTo: "edge", status: "failed" }, startedAt: null }]);
    expect(prior.completed, "the producer: a skipped row is completed").toEqual(["s9"]);
    expect(prior.attempted, "the producer: its routedTo makes it attempted (foeRunStore.ts:320)").toEqual(["s9"]);
    const h = await harness({ claimRuns: false });
    const pic = anh(h, 69, { verifiedStops: [S9], prior });
    h.central.stopsUnconfirmed = [{ runId: 69, picture: h.central.sign("runpkg", pic) }];
    expect((await h.agent.tick()).stopsResent).toEqual([69]);
    expect((await h.agent.tick()).stopsResent).toEqual([]);
    expect(h.devices.calls).toEqual([S9_DRIVER]);
  });

  // rà soát bảo mật 17/11 + DO-68: prior.completed của edgePriorPictureOf gồm cả hàng 'skipped' (foeRunStore.ts:2314) — STOP có precondition sai với
  // onPreconditionFail "skip" (foeEngine.ts:1071-1077) hay bù trừ STOP có precondition sai (:1330-1332) chưa từng tới driver: vẫn phải gửi lại
  it("X12-DU-PHONG-SKIPPED-VAN-GUI (1-đối chứng) device-port fallback, signed picture: s9's own row is 'skipped' (it never ran: precondition false, mode skip) — edgePriorPictureOf lists it in `completed` but not in `attempted` ⇒ s9 is still re-sent, once; s8 too", async () => {
    const { edgePriorPictureOf } = await import("../orchestration/foe/foeRunStore");
    const prior = edgePriorPictureOf([{ stepId: "s9", status: "skipped", resultJson: null, startedAt: null }]);
    expect(prior, "the producer: a skipped row is completed + settled, never attempted").toEqual({ ...prior0, completed: ["s9"], settled: ["s9"] });
    const h = await harness({ claimRuns: false });
    const pic = anh(h, 67, { verifiedStops: [S8_ROBOT, S9], prior });
    h.central.stopsUnconfirmed = [{ runId: 67, picture: h.central.sign("runpkg", pic) }];
    expect((await h.agent.tick()).stopsResent).toEqual([67]);
    expect((await h.agent.tick()).stopsResent, "back-off: not again in the next pull").toEqual([]);
    expect(h.devices.calls).toEqual(["stopRobot:12", S9_DRIVER]);
  });

  it("X12-DU-PHONG-SKIPPED-MAY-LOI-VAN-GUI (1-đối chứng) a walker is there but its engine re-send THROWS (edgeExecutionAgent.ts:951-953 ⇒ the device port), signed picture, s9's own row 'skipped' ⇒ the fallback still sends s9 exactly once", async () => {
    const { edgePriorPictureOf } = await import("../orchestration/foe/foeRunStore");
    const loi: EdgeWalker = { drive: async () => ({ outcome: "completed" }), abortLive: async () => ({ live: false }), resendStops: async () => Promise.reject(new Error("engine re-send failed (test)")) };
    const h = await harness({ claimRuns: false, walker: loi });
    const pic = anh(h, 68, { verifiedStops: [S9], prior: edgePriorPictureOf([{ stepId: "s9", status: "skipped", resultJson: null, startedAt: null }]) });
    h.central.stopsUnconfirmed = [{ runId: 68, picture: h.central.sign("runpkg", pic) }];
    expect((await h.agent.tick()).stopsResent).toEqual([68]);
    expect((await h.agent.tick()).stopsResent).toEqual([]);
    expect(h.devices.calls).toEqual([S9_DRIVER]);
  });

  it("X12-DU-PHONG-HONG-VAN-GUI (1-đối chứng) device-port fallback, signed picture: s9 settled but FAILED (in settled, not in completed) ⇒ s9 is still re-sent (a failed STOP is not known to have gone out)", async () => {
    const h = await harness({ claimRuns: false });
    const pic = anh(h, 43, { verifiedStops: [S8_ROBOT, S9], prior: { ...prior0, settled: ["s9"], attempted: ["s9"], startOrder: ["s9"] } });
    h.central.stopsUnconfirmed = [{ runId: 43, picture: h.central.sign("runpkg", pic) }];
    await h.agent.tick();
    expect(h.devices.calls).toEqual(["stopRobot:12", S9_DRIVER]);
  });

  it("X12-DU-PHONG-ANH-KHONG-KY-VAN-GUI (1-đối chứng, L-7) a picture whose signature does not verify, saying s9 completed ⇒ s9 is still sent (config pins), nothing offered for confirmation", async () => {
    const h = await harness({ claimRuns: false });
    const evil = generateEdgeSigningKey().key;
    const pic = anh(h, 44, { verifiedStops: [S8_ROBOT, S9], prior: { ...prior0, completed: ["s9"], settled: ["s9"], attempted: ["s9"], startOrder: ["s9"] } });
    h.central.stopsUnconfirmed = [{ runId: 44, picture: h.central.sign("runpkg", pic, evil) }];
    await h.agent.tick();
    expect(h.devices.calls).toEqual(["stopRobot:12", "stopAdapter:21:config"]);
    await h.shipper.flushAll();
    expect(eventKinds(h.central)).toContain("anomaly:EDGE_SWEEP_PICTURE_INVALID");
    expect(eventKinds(h.central)).not.toContain("sweep_stop");
  });

  it("X12-CUNG-LUOT-BO-STOP-VUA-THANH-CONG (2, đường dự phòng) one pull: the fast path executes a queued signed STOP on adapter 21 with success (pins written ⊇ s9's), then the picture of the aborted run names s9 on adapter 21 ⇒ the picture does NOT send s9: adapter 21 reaches the driver once", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    h.central.commands = [stopDaXep(h, 90, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 45, picture: h.central.sign("runpkg", anh(h, 45)) }];
    const t = await h.agent.tick();
    expect(t.commands.map((c) => [c.requestId, c.outcome]), "the queued STOP ran and succeeded").toEqual([[90, "sent"]]);
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config"]);
  });

  it("X12-CUNG-LUOT-BO-STOP-VUA-THANH-CONG-MAY (2, đường máy) one pull: the queued signed STOP on adapter 21 succeeds, then the walker re-sends the picture naming s9 on adapter 21 ⇒ s9 does not reach the driver again", async () => {
    const wm = walkerMay();
    const h = await harness({ claimRuns: false, walker: wm.walker });
    wm.port = h.devices.port;
    congCoWritten(h);
    h.central.commands = [stopDaXep(h, 91, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 46, picture: h.central.sign("runpkg", anh(h, 46)) }];
    const t = await h.agent.tick();
    expect(t.commands.map((c) => [c.requestId, c.outcome])).toEqual([[91, "sent"]]);
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config"]);
  });

  it("X12-CUNG-LUOT-STOP-LOI-VAN-GUI (2-đối chứng) one pull: the queued STOP on adapter 21 FAILS at the driver ⇒ the node does not know it went out: the picture still sends s9 (adapter 21 reached twice)", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h, (n) => (n === 1 ? { outcome: "failed", written: undefined } : {}));
    h.central.commands = [stopDaXep(h, 92, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 47, picture: h.central.sign("runpkg", anh(h, 47)) }];
    const t = await h.agent.tick();
    expect(t.commands.map((c) => [c.requestId, c.outcome])).toEqual([[92, "failed"]]);
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", S9_DRIVER]);
  });

  it("X12-CUNG-LUOT-DICH-KHAC-VAN-GUI (2-đối chứng) one pull: the queued STOP that succeeds is on ANOTHER target (robot 12) ⇒ the picture still sends s9 to adapter 21", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    h.central.commands = [stopDaXep(h, 93, { robotId: 12 })];
    h.central.stopsUnconfirmed = [{ runId: 48, picture: h.central.sign("runpkg", anh(h, 48)) }];
    const t = await h.agent.tick();
    expect(t.commands.map((c) => [c.requestId, c.outcome])).toEqual([[93, "sent"]]);
    expect(h.devices.calls).toEqual(["stopRobot:12", S9_DRIVER]);
  });

  it("X12-CUNG-LUOT-DICH-KHAC-ROBOT-VAN-GUI (2-đối chứng) one pull: the queued STOP that succeeds (pins written) is on adapter 21, the picture names s8 on ROBOT 12 ⇒ the picture still sends s8 to robot 12", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    h.central.commands = [stopDaXep(h, 103, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 59, picture: h.central.sign("runpkg", anh(h, 59, { verifiedStops: [S8_ROBOT] })) }];
    const t = await h.agent.tick();
    expect(t.commands.map((c) => [c.requestId, c.outcome])).toEqual([[103, "sent"]]);
    expect(h.devices.calls).toEqual(["stopAdapter:21:config", "stopRobot:12"]);
  });

  // ── vòng 3: TỔNG qua cả cửa sổ (Map nhớ qua các lượt pull) ─────────────────────────────────────────────────────────────

  for (const duong of ["du-phong", "may"] as const) {
    it(`X12-MAP-TONG-MOT-LAN-${duong === "may" ? "MAY" : "DU-PHONG"} (1) the queued STOP on adapter 21 succeeds (pins ⊇ s9's), the picture lists the run until its window ends ⇒ over the whole window adapter 21 reaches the driver ONCE: s9 never again`, async () => {
      const wm = walkerMay();
      const h = await harness({ claimRuns: false, ...(duong === "may" ? { walker: wm.walker } : {}) });
      wm.port = h.devices.port;
      congCoWritten(h);
      const d = dongHo(h);
      const ab = d.now - 5_000;
      h.central.commands = [stopDaXep(h, 94, { adapterId: 21 })];
      h.central.stopsUnconfirmed = [{ runId: 49, picture: h.central.sign("runpkg", anh(h, 49, { abortedAt: ab })) }];
      await quaCuaSo(h, d, new Map([[49, ab]]));
      expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config"]);
    });
  }

  it("X12-MAP-ROBOT-TONG-MOT-LAN (1, robot) the queued STOP on robot 12 is sent (the canonical abort, robotEdgeDispatch.ts:114-115), the picture names s8 on robot 12 ⇒ over the whole window robot 12 reaches the driver ONCE", async () => {
    const h = await harness({ claimRuns: false });
    const d = dongHo(h);
    const ab = d.now - 5_000;
    h.central.commands = [stopDaXep(h, 95, { robotId: 12 })];
    h.central.stopsUnconfirmed = [{ runId: 50, picture: h.central.sign("runpkg", anh(h, 50, { verifiedStops: [S8_ROBOT], abortedAt: ab })) }];
    await quaCuaSo(h, d, new Map([[50, ab]]));
    expect(h.devices.calls).toEqual(["stopRobot:12"]);
  });

  it("X12-KHOI-DONG-LAI-GUI-MOT-LAN (1, ngoại lệ 'không biết') the node skipped s9 (its own STOP covered it), then RESTARTS (its memory is gone) while the run is still listed ⇒ the restarted node sends s9 exactly once, central confirms, nothing more", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    h.central.commands = [stopDaXep(h, 96, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 51, picture: h.central.sign("runpkg", anh(h, 51)) }];
    await h.agent.tick();
    expect(toiAdapter21(h), "before the restart: only the queued STOP").toEqual(["stopAdapter:21:config"]);
    h.central.commands = [];
    await h.agent.stop();
    const h2 = await harness({ central: h.central, claimRuns: false });
    const d = dongHo(h2);
    await quaCuaSo(h2, d, new Map([[51, d.now - 5_000]]));
    expect(toiAdapter21(h2), "after the restart: s9 once (not known here any more ⇒ sent, L-7)").toEqual([S9_DRIVER]);
  });

  it("X12-GIA-TRI-LECH-VAN-GUI (1-đối chứng) the queued STOP succeeded but wrote a DIFFERENT value on the pin s9 needs ⇒ not covered: s9 is sent (once, then confirmed)", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h, () => ({ written: [{ tagKey: "run", value: true }] }));
    const d = dongHo(h);
    const ab = d.now - 5_000;
    h.central.commands = [stopDaXep(h, 97, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 52, picture: h.central.sign("runpkg", anh(h, 52, { abortedAt: ab })) }];
    await quaCuaSo(h, d, new Map([[52, ab]]));
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", S9_DRIVER]);
  });

  it("X12-SIMULATED-VAN-GUI (1-đối chứng) the queued STOP on adapter 21 was only SIMULATED ⇒ nothing was written: s9 is sent", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h, () => ({ outcome: "simulated" })); // the port even says what it would have written: simulated is still no STOP
    const d = dongHo(h);
    const ab = d.now - 5_000;
    h.central.commands = [stopDaXep(h, 98, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 53, picture: h.central.sign("runpkg", anh(h, 53, { abortedAt: ab })) }];
    await quaCuaSo(h, d, new Map([[53, ab]]));
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", S9_DRIVER]);
  });

  it("X12-KHONG-WRITTEN-VAN-GUI (1-đối chứng) a device port that does not say what it wrote (no `written`) ⇒ not covered: s9 is sent", async () => {
    const h = await harness({ claimRuns: false });
    const d = dongHo(h);
    const ab = d.now - 5_000;
    h.central.commands = [stopDaXep(h, 99, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 54, picture: h.central.sign("runpkg", anh(h, 54, { abortedAt: ab })) }];
    await quaCuaSo(h, d, new Map([[54, ab]]));
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", S9_DRIVER]);
  });

  it("X12-STOP-TRUOC-HUY-VAN-GUI (1-đối chứng) the node's STOP on adapter 21 succeeded BEFORE the run's abort ⇒ it does not cover the abort's STOP: s9 is sent", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    const d = dongHo(h);
    h.central.commands = [stopDaXep(h, 100, { adapterId: 21 })];
    await h.agent.tick();
    h.central.commands = [];
    const ab = d.now + 5_000;
    d.now += 10_000;
    h.central.stopsUnconfirmed = [{ runId: 55, picture: h.central.sign("runpkg", anh(h, 55, { abortedAt: ab })) }];
    await quaCuaSo(h, d, new Map([[55, ab]]));
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", S9_DRIVER]);
  });

  it("X12-HAI-RUN-MOC-RIENG (1) one STOP on adapter 21, run in the answer that FIRST listed run A (aborted before it); run B is aborted after it and listed in a later answer; both name s9 on adapter 21 ⇒ each run is judged on ITS OWN listing: A is covered, B's s9 is sent once", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    const d = dongHo(h);
    const abA = d.now - 5_000;
    const anhA = { runId: 56, picture: h.central.sign("runpkg", anh(h, 56, { abortedAt: abA })) };
    h.central.commands = [stopDaXep(h, 101, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [anhA];
    await h.agent.tick();
    h.central.commands = [];
    const abB = d.now + 5_000;
    d.now += 10_000;
    h.central.stopsUnconfirmed = [anhA, { runId: 57, picture: h.central.sign("runpkg", anh(h, 57, { abortedAt: abB })) }];
    await quaCuaSo(h, d, new Map([[56, abA], [57, abB]]));
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", S9_DRIVER]);
    await h.shipper.flushAll();
    expect(h.central.received.locksEvents.filter((r) => r.kind === "sweep_stop").map((r) => r.runId), "only B's s9 went (and is bound)").toEqual([57]);
  });

  it("X12-BANG-CHUNG-VAN-GUI (1-đối chứng, HST (b)) the STOP on adapter 21 ran only as EVIDENCE (its signature fails: L-7, never acked) ⇒ it does not count as known: s9 is sent", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    const d = dongHo(h);
    const ab = d.now - 5_000;
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 102, kind: "stop", target: { adapterId: 21 } }), generateEdgeSigningKey().key)];
    h.central.stopsUnconfirmed = [{ runId: 58, picture: h.central.sign("runpkg", anh(h, 58, { abortedAt: ab })) }];
    const t = await h.agent.tick();
    expect(t.commands.map((c) => c.outcome), "the evidence run").toEqual(["unverified:sent"]);
    await quaCuaSo(h, d, new Map([[58, ab]]));
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", S9_DRIVER]);
  });

  // ── vòng 4: thứ tự, không giờ ─────────────────────────────────────────────────────────────────────────────────────────────

  for (const lech of [600_000, -600_000]) {
    const ten = lech > 0 ? "NHANH" : "CHAM";
    it(`X12-LECH-GIO-${ten}-CUNG-LUOT-PHU (1) node clock ${lech > 0 ? "+" : "-"}10 min: the STOP arrives in the answer that first lists the run ⇒ covered whatever the clock: adapter 21 reaches the driver ONCE over the window`, async () => {
      const h = await harness({ claimRuns: false });
      congCoWritten(h);
      const d = dongHo(h, lech);
      const ab = d.now - 5_000;
      h.central.commands = [stopDaXep(h, 104, { adapterId: 21 })];
      h.central.stopsUnconfirmed = [{ runId: 60, picture: h.central.sign("runpkg", anh(h, 60, { abortedAt: ab })) }];
      await quaCuaSo(h, d, new Map([[60, ab]]));
      expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config"]);
    });
    it(`X12-LECH-GIO-${ten}-TRUOC-LIET-KE-GUI (1-đối chứng) node clock ${lech > 0 ? "+" : "-"}10 min: the STOP ran in a pull BEFORE any answer listed the run (it ran before the abort, which lies 5 s later on central's clock) ⇒ never covered: s9 is sent`, async () => {
      const h = await harness({ claimRuns: false });
      congCoWritten(h);
      const d = dongHo(h, lech);
      h.central.commands = [stopDaXep(h, 105, { adapterId: 21 })];
      await h.agent.tick();
      h.central.commands = [];
      const ab = d.now + 5_000;
      d.now += 10_000;
      h.central.stopsUnconfirmed = [{ runId: 61, picture: h.central.sign("runpkg", anh(h, 61, { abortedAt: ab })) }];
      await quaCuaSo(h, d, new Map([[61, ab]]));
      expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", S9_DRIVER]);
    });
  }

  it("X12-CONSOLE-SAU-HUY-PHU (1) the run is listed, s9's re-send FAILS at the driver (still listed); a console STOP on adapter 21, created after the abort, then succeeds; at the next due re-send s9 is covered ⇒ nothing more reaches adapter 21", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    const goc = h.devices.port.stopAdapter;
    let lanS9 = 0;
    h.devices.port.stopAdapter = async (id, pins, why, ctx) => {
      const r = await goc(id, pins, why, ctx);
      return pins !== null && ++lanS9 === 1 ? { ...r, outcome: "failed" as const, detail: "driver error (test)" } : r;
    };
    const d = dongHo(h);
    const ab = d.now - 5_000;
    h.central.stopsUnconfirmed = [{ runId: 62, picture: h.central.sign("runpkg", anh(h, 62, { abortedAt: ab })) }];
    await h.agent.tick(); // s9 re-sent, failed: the run stays listed
    await h.shipper.flushAll();
    d.now += 5_000; // before the re-send is due again (10 s)
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 106, kind: "stop", target: { adapterId: 21 }, issuedAt: Date.now() - 100 }))];
    await h.agent.tick();
    h.central.commands = [];
    d.now += 5_500;
    await quaCuaSo(h, d, new Map([[62, ab]]));
    expect(toiAdapter21(h)).toEqual([S9_DRIVER, "stopAdapter:21:config"]);
  });

  it("X12-TAO-TRUOC-CHAY-SAU-PHU (1) a STOP request CREATED before the abort (issuedAt 60 s before) is delivered in the answer that first lists the run and runs after it ⇒ it ran after the abort (order proven by the answer): covered, adapter 21 reaches the driver ONCE", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    const d = dongHo(h);
    const ab = d.now - 5_000;
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 107, kind: "stop", target: { adapterId: 21 }, issuedAt: Date.now() - 60_000 }))];
    h.central.stopsUnconfirmed = [{ runId: 63, picture: h.central.sign("runpkg", anh(h, 63, { abortedAt: ab })) }];
    await quaCuaSo(h, d, new Map([[63, ab]]));
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config"]);
  });

  it("X12-ANH-HONG-KHONG-DAT-MOC-VAN-GUI (1-đối chứng) the answer that first lists the run carries a picture that does NOT verify; the STOP of that answer succeeds; later answers carry the verified picture ⇒ the STOP ran before any VERIFIED listing: not covered, s9 is sent", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    const d = dongHo(h);
    const ab = d.now - 5_000;
    const pic = anh(h, 64, { abortedAt: ab });
    h.central.commands = [stopDaXep(h, 108, { adapterId: 21 })];
    h.central.stopsUnconfirmed = [{ runId: 64, picture: h.central.sign("runpkg", pic, generateEdgeSigningKey().key) }];
    await h.agent.tick(); // forged picture: s9 sent anyway (L-7, config pins), never offered for confirmation
    h.central.commands = [];
    d.now += 10_500;
    h.central.stopsUnconfirmed = [{ runId: 64, picture: h.central.sign("runpkg", pic) }];
    await quaCuaSo(h, d, new Map([[64, ab]]));
    expect(toiAdapter21(h)).toEqual(["stopAdapter:21:config", "stopAdapter:21:config", S9_DRIVER]);
  });

  // ── vòng 5: mốc của run bị đặt lại / phản hồi tới sai thứ tự ⇒ chỉ có thể muộn hơn (hướng đóng: gửi lại) ──────────────────────

  /** s9's re-sends through the step pins fail at the driver the first `n` times (the run stays listed) */
  function s9Hong(h: H, n = 1) {
    const goc = h.devices.port.stopAdapter;
    let lan = 0;
    h.devices.port.stopAdapter = async (id, pins, why, ctx) => {
      const r = await goc(id, pins, why, ctx);
      return pins !== null && ++lan <= n ? { ...r, outcome: "failed" as const, detail: "driver error (test)" } : r;
    };
  }
  /** one pull answer as central gives it while its run side is unavailable (edgeProtocol.ts:570-576): commands only, no run listed */
  const phanThieu = (h: H) => () => ({ status: 200, data: { node: "edge-a", protocolVersion: 2, configVersion: 1, keysetVersion: 1, programCheckRequested: false, runs: [], claims: [], stopsUnconfirmed: [], commands: h.central.commands, runStateUnavailable: true } });

  it("X12-ROI-DANH-SACH-DAT-LAI-MOC-VAN-GUI (vòng 5, mốc đặt lại ⇒ gửi lại) the run is listed, s9 fails; a FULL answer without the run (confirmed, or an answer built before the abort arriving late) drops its mark; a STOP on adapter 21 succeeds while the run is not listed; the run is listed again ⇒ the STOP ran before the NEW first listing: s9 is sent", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    s9Hong(h);
    const d = dongHo(h);
    const ab = d.now - 5_000;
    const r = { runId: 65, picture: h.central.sign("runpkg", anh(h, 65, { abortedAt: ab })) };
    h.central.stopsUnconfirmed = [r];
    await h.agent.tick();
    d.now += 1_000;
    h.central.stopsUnconfirmed = [];
    await h.agent.tick();
    d.now += 1_000;
    h.central.commands = [stopDaXep(h, 109, { adapterId: 21 })];
    await h.agent.tick();
    h.central.commands = [];
    d.now += 1_000;
    h.central.stopsUnconfirmed = [r];
    await quaCuaSo(h, d, new Map([[65, ab]]));
    expect(toiAdapter21(h)).toEqual([S9_DRIVER, "stopAdapter:21:config", S9_DRIVER]);
  });

  it("X12-THIEU-PHAN-GIU-MOC-PHU (vòng 5) the run is listed, s9 fails; a PARTIAL answer (runStateUnavailable: nothing is inferred from what it omits, edgeExecutionAgent.ts:550-551) carries a STOP on adapter 21 that succeeds; the run is listed again ⇒ the mark of the first listing is kept: covered, nothing more reaches adapter 21", async () => {
    const h = await harness({ claimRuns: false });
    congCoWritten(h);
    s9Hong(h);
    const d = dongHo(h);
    const ab = d.now - 5_000;
    h.central.stopsUnconfirmed = [{ runId: 66, picture: h.central.sign("runpkg", anh(h, 66, { abortedAt: ab })) }];
    await h.agent.tick();
    d.now += 5_000;
    h.central.commands = [stopDaXep(h, 110, { adapterId: 21 })];
    h.central.handlers.pull = phanThieu(h);
    const t = await h.agent.tick();
    delete h.central.handlers.pull;
    h.central.commands = [];
    expect(t.commands.map((c) => [c.requestId, c.outcome]), "STOPs still go in a partial answer").toEqual([[110, "sent"]]);
    d.now += 5_500;
    await quaCuaSo(h, d, new Map([[66, ab]]));
    expect(toiAdapter21(h)).toEqual([S9_DRIVER, "stopAdapter:21:config"]);
  });
});

describe("doc 81 Đợt 10 E — agent v2: fix review 1 minors", () => {
  it("★ M-7: an UNVERIFIED sweep picture never skips a STOP — its `abortSentBefore` is not trusted", async () => {
    const h = await harness({ claimRuns: false });
    const evil = generateEdgeSigningKey().key;
    const pic = h.central.sweepPicture(35, { prior: { completed: [], settled: [], attempted: [], startOrder: [], branches: [], abortSentBefore: ["s-r", "s-o", "s-done"], unknown: false } });
    h.central.stopsUnconfirmed = [{ runId: 35, picture: h.central.sign("runpkg", pic, evil) }];
    await h.agent.tick();
    expect(h.devices.calls).toEqual(["stopRobot:12", "stopAdapter:21:config", "stopRobot:12"]);
  });

  it("★ M-8: the error of an ABORTED segment end reaches central", async () => {
    const h = await harness({ walker: { drive: async () => ({ outcome: "aborted", error: "EDGE_OUTCOME_UNKNOWN(m1)" }), abortLive: async () => ({ live: false }) } });
    h.central.addRun(9);
    await h.agent.tick();
    await h.agent.idle();
    expect(h.central.callsTo("complete")[0].body).toMatchObject({ outcome: "aborted", error: "EDGE_OUTCOME_UNKNOWN(m1)" });
  });

  it("★ M-3: pending nonces are bounded — settled on use, and at the latest at TTL lapse", async () => {
    let mono = 1_000;
    const central = new FakeCentral();
    const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl, monoNow: () => mono });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-nonce-"));
    dirs.push(dir);
    const config = await EdgeConfigSource.create({ client, pin: central.pin, nodeId: 7, credentialId: 31, credential: KIT_TOKEN, dir });
    await config.refresh();
    const az = createEdgeAuthorizeClient({ client, trust: () => config.trust(), credentialId: () => 31, maxTtlMs: () => 10_000, isJtiConsumed: () => false, programChecks: () => [] });
    const ask = () => az.authorize({ runId: 9, claimSeq: 1, claimToken: `ect_${"A".repeat(43)}`, stepId: "m1", attempt: 1, idempotencyKey: "k", command: { kind: "robot", robotId: 12, jobType: "move", params: {} }, payloadHash: PH });
    const a = await ask();
    expect(a.ok).toBe(true);
    expect(az.pendingCount()).toBe(1);
    if (a.ok) az.settleNonce(a.reqNonce);
    expect(az.pendingCount()).toBe(0);
    for (let i = 0; i < 5; i++) await ask();
    expect(az.pendingCount()).toBe(5);
    mono += 31_000; // past the maximum TTL: every earlier nonce is useless and pruned on the next authorize
    await ask();
    expect(az.pendingCount()).toBe(1);
  });

  it("★ fix review 6 (R-10-bn, F1-3): a token that arrives AFTER its TTL (central hung) is never used — verdict `unavailable` (the run is HELD, D5), not `refused`; a tampered token stays `refused`", async () => {
    let mono = 1_000;
    const central = new FakeCentral();
    const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl, monoNow: () => mono });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-late-"));
    dirs.push(dir);
    const config = await EdgeConfigSource.create({ client, pin: central.pin, nodeId: 7, credentialId: 31, credential: KIT_TOKEN, dir });
    await config.refresh();
    const anomalies: string[] = [];
    const az = createEdgeAuthorizeClient({ client, trust: () => config.trust(), credentialId: () => 31, maxTtlMs: () => 10_000, isJtiConsumed: () => false, programChecks: () => [], anomaly: (code, _r, d) => anomalies.push(`${code}: ${d}`) });
    const ask = () => az.authorize({ runId: 9, claimSeq: 1, claimToken: `ect_${"A".repeat(43)}`, stepId: "m1", attempt: 1, idempotencyKey: "k", command: { kind: "robot", robotId: 12, jobType: "move", params: {} }, payloadHash: PH });
    const kit = central as unknown as { defaults: (route: string, body: unknown, runId?: number) => unknown };
    central.handlers.authorize = (b, runId) => {
      const genuine = kit.defaults("authorize", b, runId);
      mono += 10_001; // central answered only after the token's TTL (10 s from the FIRST send) had lapsed
      return genuine as never;
    };
    const late = await ask();
    expect(late).toMatchObject({ ok: false, verdict: "unavailable", code: "auth_expired" }); // never `ok` ⇒ never used (A2(d))
    expect(az.pendingCount()).toBe(0);
    expect(anomalies).toEqual([expect.stringMatching(/^EDGE_AUTH_INVALID: step m1 attempt 1: expired$/)]);
    // in time but TAMPERED: still refused
    central.handlers.authorize = (b, runId) => {
      const g = kit.defaults("authorize", b, runId) as { data: { authorization: { sig: string } } };
      return { ...g, data: { ...g.data, authorization: { ...g.data.authorization, sig: g.data.authorization.sig.slice(0, -4) + "AAAA" } } } as never;
    };
    expect(await ask()).toMatchObject({ ok: false, verdict: "refused", code: "auth_invalid" });
  });
});

describe("doc 81 Đợt 10 E — agent v2: restart + hygiene", () => {
  it("★ after a restart, run records whose claim token was lost become events evidence (every ledger record as actuation), never a stuck stream", async () => {
    const h = await harness();
    await h.journal.appendRun(9, 2, { kind: "ledger", stepId: "stop1", attempt: 1, idempotencyKey: "k", jti: null, stop: true, target: { robotId: 12, jobType: "abort" }, status: "done", result: null, at: 5 });
    await h.journal.appendRun(9, 2, { kind: "step", stepId: "m1", stepType: "command", status: "running", attempt: 1, startedAt: 1, finishedAt: null, error: null, result: null, jti: null });
    expect(await h.shipper.orphanUntokened("claim token lost on restart")).toBe(2);
    expect(h.journal.pending("run:9:2")).toEqual([]);
    await h.shipper.flushAll();
    expect(eventKinds(h.central)).toEqual(["actuation", "anomaly:EDGE_RUN_REPORT_ORPHANED"]);
    expect(h.central.received.locksEvents[0]).toMatchObject({ kind: "actuation", runId: 9, claimSeq: 2, stepId: "stop1", stop: true, target: { robotId: 12, jobType: "abort" }, outcome: "done" });
  });

  it("★ the credential never appears in what the agent logs (offline, refusals, anomalies)", async () => {
    const h = await harness();
    h.central.addRun(9);
    h.central.handlers.claim = () => ({ status: 409, code: "claim_conflict" });
    await h.agent.tick();
    h.central.down = true;
    await h.agent.tick();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(KIT_TOKEN.split(".")[1]);
    expect(logs.join("\n")).not.toContain(KIT_TOKEN);
  });
});
