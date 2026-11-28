/**
 * X-EDGE-ABORT-TUOI — the EDGE AGENT against a FAKE CENTRAL that answers `abortAgeMs` ONLY to a node sending `x-edge-node-accepts: answer.abort_age`
 * (as edgeNodeRoutes.nhanTuoiAbort). Real client (monotonic clock injected) / journal / config / shipper / authorize client; the walker is a fake that
 * records which of its three abort doors the agent opened: abortLive (sweep, as today), chanNonStopAbortCu (too old / no time: NO sweep), baoTrungTamCu
 * (an old central: no age at all). Measured, on the three paths that carry central's abort to a LIVE segment:
 *   • L2 progress 200 abortRequested: within 15 min ⇒ sweep (control); past ⇒ no sweep, flagged once; null ⇒ no sweep (refusedNoTime); absent ⇒ sweep +
 *     warned once;
 *   • L1 pull claims abortRequested, L3 progress claim_stale abortRequested: past ⇒ no sweep;
 *   • Q2: the age is reckoned at the decision — central's age + this node's monotonic time since the request went out (a slow answer ages the abort);
 *   • the header goes on EVERY request; the held reason abortStopsWithheld goes on the wire only to a central advertising held.abort_stops_withheld,
 *     the baseline otherwise; a 400 to it keeps the segment end and sends the baseline next time.
 *   • L4 on the REAL authorize client (createEdgeAuthorizeClient over the real EdgeCentralClient): a 409 stopped / claim_stale carrying central's
 *     age gives the walker `tuoi` (central's age, the send time, the monotonic clock); no age ⇒ no `tuoi` (bản 3 C-a).
 * The wire strings are literals here on purpose: they are the contract with central, not a constant this test can follow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EdgeCentralClient, createEdgeAuthorizeClient } from "./edgeCentralClient";
import { EdgeConfigSource } from "./edgeConfigSource";
import { EdgeExecutionAgent, type EdgeAgentConfig, type EdgeDevicePort, type EdgeSegmentOutcome, type EdgeWalker } from "./edgeExecutionAgent";
import { FakeCentral, KIT_TOKEN, kitHashDefinition } from "./edgeFakeCentral.testkit";
import { EdgeJournal } from "./edgeJournal";
import { EDGE_CENTRAL_ACCEPTS } from "./edgeProtocol";
import { EdgeProgramChecks, EdgeStreamShipper, createEdgeAuthUnusedReporter, createEdgeJournalConsume, createEdgeReportSink } from "./edgeStreams";

const HDR = "x-edge-node-accepts";
const TOKEN = "answer.abort_age";
const CUA = 15 * 60_000; // R-6-d, by definition (shared/foeAbortResend.ABORT_RESEND_WINDOW_MS)

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

const devices: EdgeDevicePort = {
  stopRobot: async () => ({ outcome: "sent" }),
  stopAdapter: async () => ({ outcome: "sent" }),
  lockRobot: async () => ({ ok: true, generation: 4 }),
  clearRobot: async () => ({ ok: true as const, generation: 4 }),
};

type ChanX = { lyDo: string; abortAgeMs: number | null; tuoi: number | null };
/** A walker that holds its segment until released (central's abort arrives while it walks) and records its abort doors. */
function cuaWalker(ketQua: EdgeSegmentOutcome = { outcome: "completed" }) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const w = {
    release: () => release(),
    abortLive: [] as number[],
    chan: [] as Array<{ runId: number } & ChanX>,
    trungTamCu: [] as number[],
    signals: [] as AbortSignal[],
    walker: null as unknown as EdgeWalker,
  };
  // the two X-EDGE-ABORT-TUOI hooks are optional members of EdgeWalker: an object literal carrying them is the walker loadDefaultEdgeWalker builds
  const walker = {
    drive: async (_pkg: unknown, io: { signal: AbortSignal }): Promise<EdgeSegmentOutcome> => {
      w.signals.push(io.signal);
      await gate;
      return io.signal.aborted ? { outcome: "aborted" } : ketQua;
    },
    abortLive: async (runId: number) => (w.abortLive.push(runId), { live: true }),
    chanNonStopAbortCu: async (runId: number, x: ChanX) => (w.chan.push({ runId, ...x }), { live: true }),
    baoTrungTamCu: (runId: number) => void w.trungTamCu.push(runId),
  };
  w.walker = walker as unknown as EdgeWalker;
  return w;
}

/**
 * The harness: as edgeExecutionAgent.dot10's, plus — the client's monotonic clock is `clock.mono` (the next progress answer advances it by
 * `clock.transit`, the time that answer takes to come back); every request's node-accepts header is recorded; `tuoi(ms)` is what central answers as abortAgeMs, given ONLY
 * when the request carried the token (undefined ⇒ an old central: never given).
 */
async function harness(o: { walker: EdgeWalker; progressMs?: number }) {
  const central = new FakeCentral();
  const clock = { mono: 1_000_000, transit: 0 };
  const hdrs: Array<{ url: string; v: string | undefined }> = [];
  let lastHdr: string | undefined;
  const fetchImpl = (async (url: string | URL, init?: { body?: unknown; headers?: Record<string, string> }) => {
    lastHdr = init?.headers?.[HDR];
    hdrs.push({ url: String(url), v: lastHdr });
    const res = await central.fetchImpl(url, init as RequestInit);
    // the NEXT progress answer comes back `transit` ms later (once): what the node reckons from its own send time
    if (clock.transit > 0 && /\/progress$/.test(new URL(String(url)).pathname)) {
      clock.mono += clock.transit;
      clock.transit = 0;
    }
    return res;
  }) as unknown as typeof fetch;
  /** central's abortAgeMs for THIS request: present only to a node that advertised the token (exact token, as nodeAccepts) */
  const tuoi = (ms: number | null | undefined): { abortAgeMs?: number | null } =>
    ms !== undefined && (lastHdr ?? "").split(",").map((t) => t.trim()).includes(TOKEN) ? { abortAgeMs: ms } : {};
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-abort-tuoi-"));
  dirs.push(dir);
  const journal = await EdgeJournal.open({ dir, groupCommitMs: 1 });
  journals.push(journal);
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl, monoNow: () => clock.mono });
  const config = await EdgeConfigSource.create({ client, pin: central.pin, nodeId: central.nodeId, credentialId: central.credentialId, credential: KIT_TOKEN, dir });
  expect(await config.refresh()).toMatchObject({ ok: true });
  const shipper = new EdgeStreamShipper(journal, client);
  const sink = createEdgeReportSink(journal, (s) => shipper.nudge(s));
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
  const cfg: EdgeAgentConfig = { centralUrl: "http://central.test", credential: KIT_TOKEN, pullIntervalMs: 60_000, progressMs: o.progressMs ?? 60_000, maxConcurrent: 2, requestTimeoutMs: 2_000, stopResendMinMs: 10_000 };
  const agent = new EdgeExecutionAgent(cfg, { client, config, journal, shipper, sink, consume: createEdgeJournalConsume(journal), authorize, programChecks, walker: o.walker, devices, hashDefinition: kitHashDefinition });
  agents.push(agent);
  return { central, clock, hdrs, tuoi, agent, authorize };
}

/** progress answers abortRequested with central's age `ms` (see harness.tuoi) */
function progressAbort(h: Awaited<ReturnType<typeof harness>>, ms: number | null | undefined) {
  h.central.handlers.progress = () => ({ status: 200, data: { abortRequested: true, status: "aborted", consistent: true, commands: [], ...h.tuoi(ms) } });
}
const lap = () => new Promise((r) => setTimeout(r, 80));

describe("X-EDGE-ABORT-TUOI — the agent: central's abort of a LIVE segment, by its age", () => {
  it("★ A1 — L2 progress, central's age 1 min (within 15 min) ⇒ sweep as today: abortLive once, the signal aborted, no hold (control)", async () => {
    const w = cuaWalker();
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    progressAbort(h, 60_000);
    await vi.waitFor(() => expect(w.abortLive, "A1: abortLive").toEqual([9]), { timeout: 2_000 });
    await lap();
    expect([w.abortLive, w.chan, w.signals[0]!.aborted], "A1: doors").toEqual([[9], [], true]);
    w.release();
    await h.agent.idle();
    expect(h.central.callsTo("complete")[0]!.body.outcome, "A1: end").toBe("aborted");
  });

  it("★ A2 — L2 progress, central's age 16 min ⇒ NO sweep: the walker flagged ONCE (refusedTooOld, central's age and the reckoned age), its signal NOT aborted, abortLive never", async () => {
    const w = cuaWalker();
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    progressAbort(h, CUA + 60_000);
    await vi.waitFor(() => expect(w.chan.length, "A2: flagged").toBe(1), { timeout: 2_000 });
    await lap(); // more progress answers, the same abort
    expect([w.abortLive, w.chan, w.signals[0]!.aborted], "A2: doors").toEqual([[], [{ runId: 9, lyDo: "refusedTooOld", abortAgeMs: CUA + 60_000, tuoi: CUA + 60_000 }], false]);
    w.release();
    await h.agent.idle();
  });

  it("★ A3 — L2 progress, central's age null (no known time) ⇒ NO sweep: flagged once, refusedNoTime, both ages null", async () => {
    const w = cuaWalker();
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    progressAbort(h, null);
    await vi.waitFor(() => expect(w.chan.length, "A3: flagged").toBe(1), { timeout: 2_000 });
    await lap();
    expect([w.abortLive, w.chan], "A3: doors").toEqual([[], [{ runId: 9, lyDo: "refusedNoTime", abortAgeMs: null, tuoi: null }]]);
    w.release();
    await h.agent.idle();
  });

  it("★ A4 — L2 progress, an OLD central (no abortAgeMs at all) ⇒ sweep as today, and warned ONCE for the run (baoTrungTamCu)", async () => {
    const w = cuaWalker();
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    progressAbort(h, undefined);
    await vi.waitFor(() => expect(w.abortLive, "A4: abortLive").toEqual([9]), { timeout: 2_000 });
    await lap();
    expect([w.abortLive, w.chan, w.trungTamCu], "A4: doors").toEqual([[9], [], [9]]);
    w.release();
    await h.agent.idle();
  });

  it("★ A5 — L1 pull claims abortRequested, central's age 16 min ⇒ NO sweep: flagged once; not in the tick's `aborted`", async () => {
    const w = cuaWalker();
    const h = await harness({ walker: w.walker });
    h.central.addRun(9);
    await h.agent.tick();
    // the claim row is set before the next pull goes out: h.tuoi reads the header of the requests so far (every request carries the same one, A8);
    // the extra key is what central adds for a node advertising answer.abort_age — the fake's claim rows have no field for it
    h.central.claims = [{ runId: 9, claimSeq: 1, status: "aborted", abortRequested: true, stale: false, ...h.tuoi(CUA + 60_000) } as (typeof h.central.claims)[number]];
    const t = await h.agent.tick();
    expect([t.aborted, w.abortLive, w.chan], "A5: doors").toEqual([[], [], [{ runId: 9, lyDo: "refusedTooOld", abortAgeMs: CUA + 60_000, tuoi: CUA + 60_000 }]]);
    w.release();
    await h.agent.idle();
  });

  it("★ A6 — L3 progress claim_stale with abortRequested, central's age 16 min ⇒ NO sweep: flagged once", async () => {
    const w = cuaWalker();
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    h.central.handlers.progress = () => ({ status: 409, code: "claim_stale", details: { abortRequested: true, ...h.tuoi(CUA + 60_000) } });
    await vi.waitFor(() => expect(w.chan.length, "A6: flagged").toBe(1), { timeout: 2_000 });
    await lap();
    expect([w.abortLive, w.chan], "A6: doors").toEqual([[], [{ runId: 9, lyDo: "refusedTooOld", abortAgeMs: CUA + 60_000, tuoi: CUA + 60_000 }]]);
    w.release();
    await h.agent.idle();
  });

  it("★ A7 — Q2: central says 14 min; the answer takes 2 min to come back ⇒ reckoned 16 min at the decision ⇒ NO sweep (with no transit: sweep)", async () => {
    const w0 = cuaWalker();
    const h0 = await harness({ walker: w0.walker, progressMs: 20 });
    h0.central.addRun(9);
    await h0.agent.tick();
    progressAbort(h0, 14 * 60_000);
    await vi.waitFor(() => expect(w0.abortLive, "A7: no transit ⇒ sweep").toEqual([9]), { timeout: 2_000 });
    w0.release();
    await h0.agent.idle();

    const w = cuaWalker();
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    h.clock.transit = 2 * 60_000;
    progressAbort(h, 14 * 60_000);
    await vi.waitFor(() => expect(w.chan.length, "A7: transit ⇒ flagged").toBe(1), { timeout: 2_000 });
    expect([w.abortLive, w.chan], "A7: doors").toEqual([[], [{ runId: 9, lyDo: "refusedTooOld", abortAgeMs: 14 * 60_000, tuoi: 16 * 60_000 }]]);
    w.release();
    await h.agent.idle();
  });

  it("★ A8 — the node-accepts header `answer.abort_age` goes on EVERY request (pull, claim, progress, complete)", async () => {
    const w = cuaWalker();
    const h = await harness({ walker: w.walker, progressMs: 20 });
    h.central.addRun(9);
    await h.agent.tick();
    await vi.waitFor(() => expect(h.central.callsTo("progress").length > 0, "A8: progress").toBe(true), { timeout: 2_000 });
    w.release();
    await h.agent.idle();
    const routes = new Set(h.central.calls.map((c) => c.route));
    expect(["pull", "claim", "progress", "complete"].every((r) => routes.has(r as never)), "A8: routes seen").toBe(true);
    expect([...new Set(h.hdrs.map((x) => x.v))], "A8: the header of every request").toEqual([TOKEN]);
  });
});

describe("X-EDGE-ABORT-TUOI — the agent: the held reason abortStopsWithheld on the wire", () => {
  const heldAbort: EdgeSegmentOutcome = { outcome: "held", heldReason: "abortStopsWithheld" as never };

  it("★ A9-a — a central advertising held.abort_stops_withheld gets heldReason abortStopsWithheld", async () => {
    const w = cuaWalker(heldAbort);
    const h = await harness({ walker: w.walker });
    h.central.accepts = [...EDGE_CENTRAL_ACCEPTS, "held.abort_stops_withheld"];
    h.central.addRun(9);
    await h.agent.tick();
    w.release();
    await h.agent.idle();
    expect(h.central.callsTo("complete").map((c) => c.body.heldReason), "A9-a").toEqual(["abortStopsWithheld"]);
  });

  it("★ A9-b — a central NOT advertising it gets the baseline centralUnreachable", async () => {
    const w = cuaWalker(heldAbort);
    const h = await harness({ walker: w.walker });
    h.central.accepts = EDGE_CENTRAL_ACCEPTS.filter((t) => t !== "held.abort_stops_withheld");
    h.central.addRun(9);
    await h.agent.tick();
    w.release();
    await h.agent.idle();
    expect(h.central.callsTo("complete").map((c) => c.body.heldReason), "A9-b").toEqual(["centralUnreachable"]);
  });

  it("★ A9-c — the central advertised it but answers 400 bad_request ⇒ the end is KEPT and sent again with the baseline, then taken", async () => {
    const w = cuaWalker(heldAbort);
    const h = await harness({ walker: w.walker });
    h.central.accepts = [...EDGE_CENTRAL_ACCEPTS, "held.abort_stops_withheld"];
    let lan = 0;
    h.central.handlers.complete = (body) => (++lan === 1 ? { status: 400, code: "bad_request" } : { status: 200, data: { abortRequested: false, status: body.outcome } });
    h.central.addRun(9);
    await h.agent.tick();
    w.release();
    await h.agent.idle();
    await h.agent.tick(); // the kept end goes now
    await h.agent.idle();
    await h.agent.tick(); // and nothing after it was taken
    await h.agent.idle();
    expect(h.central.callsTo("complete").map((c) => c.body.heldReason), "A9-c").toEqual(["abortStopsWithheld", "centralUnreachable"]);
  });
});

describe("X-EDGE-ABORT-TUOI — L4 on the REAL authorize client: central's age reaches the walker as `tuoi`", () => {
  const PH = "sha256:" + "c".repeat(64);
  const xin = { runId: 9, claimSeq: 1, claimToken: "ect_" + "a".repeat(43), stepId: "m1", attempt: 1, idempotencyKey: "foe:9:m1:1", command: { kind: "robot", robotId: 12, jobType: "custom", params: {} }, payloadHash: PH };
  const goi = async (h: Awaited<ReturnType<typeof harness>>) => (await h.authorize.authorize(xin as never)) as unknown as Record<string, any>;

  it("★ A10-a — 409 stopped with central's age 16 min ⇒ verdict stopped, code stopped, tuoi { abortAgeMs, guiLuc = the node's clock before the send, monoNow = that clock }", async () => {
    const h = await harness({ walker: cuaWalker().walker });
    h.central.handlers.authorize = () => ({ status: 409, code: "stopped", details: { ...h.tuoi(CUA + 60_000) } });
    const o = await goi(h);
    expect([o.ok, o.verdict, o.code, o.tuoi?.abortAgeMs, o.tuoi?.guiLuc], "A10-a").toEqual([false, "stopped", "stopped", CUA + 60_000, 1_000_000]);
    h.clock.mono += 5;
    expect(typeof o.tuoi?.monoNow === "function" && o.tuoi.monoNow() === 1_000_005, "A10-a: the walker reckons on the node's clock").toBe(true);
  });

  it("★ A10-b — 409 claim_stale with abortRequested and central's age ⇒ verdict stale, abortRequested true, tuoi carried (the store turns it into 'stopped')", async () => {
    const h = await harness({ walker: cuaWalker().walker });
    h.central.handlers.authorize = () => ({ status: 409, code: "claim_stale", details: { abortRequested: true, ...h.tuoi(CUA + 60_000) } });
    const o = await goi(h);
    expect([o.ok, o.verdict, o.code, o.abortRequested, o.tuoi?.abortAgeMs, o.tuoi?.guiLuc], "A10-b").toEqual([false, "stale", "claim_stale", true, CUA + 60_000, 1_000_000]);
  });

  it("★ A10-c — an OLD central (409 stopped, no age) ⇒ no `tuoi` key at all (quyetAbortCu ⇒ trungTamCu: swept as today)", async () => {
    const h = await harness({ walker: cuaWalker().walker });
    h.central.handlers.authorize = () => ({ status: 409, code: "stopped" });
    const o = await goi(h);
    expect([o.verdict, o.code, "tuoi" in o], "A10-c").toEqual(["stopped", "stopped", false]);
  });

  it("★ A10-d — central's age null (unknown) ⇒ tuoi { abortAgeMs: null } (refusedNoTime downstream)", async () => {
    const h = await harness({ walker: cuaWalker().walker });
    h.central.handlers.authorize = () => ({ status: 409, code: "stopped", details: { ...h.tuoi(null) } });
    const o = await goi(h);
    expect([o.verdict, o.tuoi?.abortAgeMs, typeof o.tuoi?.guiLuc], "A10-d").toEqual(["stopped", null, "number"]);
  });
});
