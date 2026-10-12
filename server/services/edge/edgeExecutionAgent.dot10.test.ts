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
import { EdgeJournal } from "./edgeJournal";
import { generateEdgeSigningKey } from "./edgeSigning";
import { EdgeProgramChecks, EdgeStreamShipper, createEdgeJournalConsume, createEdgeReportSink } from "./edgeStreams";

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

async function harness(o: { central?: FakeCentral; walker?: EdgeWalker | null; claimRuns?: boolean; journalMaxBytes?: number; progressMs?: number } = {}) {
  const central = o.central ?? new FakeCentral();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-agent-"));
  dirs.push(dir);
  const journal = await EdgeJournal.open({ dir, groupCommitMs: 1, maxBytes: o.journalMaxBytes });
  journals.push(journal);
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl });
  const config = await EdgeConfigSource.create({ client, pin: central.pin, nodeId: central.nodeId, credentialId: central.credentialId, credential: KIT_TOKEN, dir });
  expect(await config.refresh()).toMatchObject({ ok: true });
  const shipper = new EdgeStreamShipper(journal, client);
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
  });
  const devices = fakeDevices();
  const w = fakeWalker();
  const cfg: EdgeAgentConfig = { centralUrl: "http://central.test", credential: KIT_TOKEN, pullIntervalMs: 60_000, progressMs: o.progressMs ?? 60_000, maxConcurrent: 2, requestTimeoutMs: 2_000, stopResendMinMs: 10_000, claimRuns: o.claimRuns };
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
  it("★ a verified STOP is sent at once and acknowledged; a duplicate delivery runs once", async () => {
    const h = await harness({ claimRuns: false });
    const stop = h.central.sign("cmd", h.central.commandPayload({ requestId: 41, kind: "stop", target: { robotId: 12 } }));
    h.central.commands = [stop];
    await h.agent.tick();
    await h.agent.tick();
    expect(h.devices.calls).toEqual(["stopRobot:12"]);
    await h.shipper.flushAll();
    expect(eventKinds(h.central)).toEqual(['stop:command:{"robotId":12}:sent', "ack:41:done"]);
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
    expect(t.commands.map((c) => c.outcome)).toEqual(["unverified:sent", "unverified:not_owned", "refused:unknown_kid", "refused:unknown_kid"]);
    await h.shipper.flushAll();
    const ev = eventKinds(h.central);
    expect(ev.filter((e) => e === "anomaly:EDGE_COMMAND_INVALID")).toHaveLength(4);
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
    expect(h.journal.pending("events").some((e) => e.record.kind === "command_ack")).toBe(true);
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
    expect(acks(h.central).map((r) => [r.requestId, r.outcome])).toEqual([[97, "done"], [98, "done"]]);
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
    expect(acks(h.central).map((r) => [r.requestId, r.outcome])).toEqual([[99, "done"], [100, "done"]]);
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

describe("doc 81 Đợt 10 E — agent v2: STOP re-send from the sweep picture (L-7)", () => {
  it("★ verified picture: every STOP not confirmed before is re-sent (OT with the picture's pins), at most once per interval", async () => {
    const h = await harness({ claimRuns: false });
    h.central.stopsUnconfirmed = [{ runId: 33, picture: h.central.sign("runpkg", h.central.sweepPicture(33)) }];
    expect((await h.agent.tick()).stopsResent).toEqual([33]);
    expect(h.devices.calls).toEqual(["stopRobot:12", 'stopAdapter:21:[{"tagKey":"run","value":false}]']);
    expect((await h.agent.tick()).stopsResent).toEqual([]);
    expect(h.devices.calls).toHaveLength(2);
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
