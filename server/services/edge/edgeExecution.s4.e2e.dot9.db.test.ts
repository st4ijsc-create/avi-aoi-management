/**
 * doc 81 Đợt 9 task S4 — END TO END, TWO PROCESSES over HTTP (127.0.0.1, port 0), `_test` DB.
 *
 * ★ ADAPTED TO THE v2 FLOW 2026-10-13 (doc 81 Đợt 10 task F1, ruling R-10-bi). The Đợt 9 version spawned edgeE2eChild.dot9 —
 *   the v1 agent walking THE CENTRAL RUN on the central DB (foeEngine.driveEdgeClaimedRun, removed by Đợt 10 C) with the DB
 *   reachable from the edge. The v2 edge holds NO DB: the edge process is now `server/edge/edgeGatewayMain.ts` with no
 *   DATABASE_URL (edgeE2eChild.dot10, through __edgeE2eHarness.dot10), central signs a run package at the claim and a per-step
 *   authorisation, the edge reports, central writes every row. Each Đợt 9 proof is kept, restated for v2:
 *     1 assign → pull → run → complete with a central approval      — kept (signed package, claim seq 2, the edge's robot moves);
 *     2 abort mid-run + replays refused                             — kept (m2 never sent; ONE STOP; progress / claim / complete
 *                                                                     replays refused; never resurrected). The Đợt 9 "central
 *                                                                     also tried, late, and failed" case is moot in v2: central
 *                                                                     holds no session for an edge-owned robot and never sends
 *                                                                     its motion (ROBOT_OWNED_BY_EDGE) — asserted instead;
 *     3 L-7 aborted while PAUSED after actuating                    — kept (the edge re-sends the STOP from a SIGNED sweep picture);
 *     4 out-of-scope node                                           — kept (node B's answers equal "missing"; A never takes B's);
 *     5 offline                                                     — kept, v2 semantics (D5): no new run claimed; the walking
 *                                                                     run's next non-STOP step cannot be authorised (never
 *                                                                     sent); a central abort written meanwhile reaches the edge
 *                                                                     on reconnect and its STOP goes out;
 *     6 credential revoked                                          — kept (pull 401, the run stays queued) + the edge process
 *                                                                     report: every motion central recorded came from the edge,
 *                                                                     and the edge never touched the DB.
 *   The old v1 child (edgeE2eChild.dot9.test.ts) is retired with this adaptation (replaced by edgeE2eChild.dot10.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.hoisted(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "f1-dot9-s4-v2-session-secret-0123456789abcdef";
});

import { setupCentral, waitFor, sleep, noDbEvidence, type Central, type EdgeProc, type CentralTestHooks } from "./__edgeE2eHarness.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let c: Central;
let edge: EdgeProc;

const motions = () => (edge.counts()?.motions ?? []).filter((m) => m.robotId === c.ids.robotA).length;
const stops = () => (edge.counts()?.stops ?? []).filter((m) => m.robotId === c.ids.robotA).length;
const motionRows = async (runId: number) => Number((await c.sql`SELECT count(*)::int AS n FROM robot_jobs WHERE "actionId" LIKE ${`foe-run${runId}-%`} AND status = 'done'`)[0].n);

/** test-only central pieces (CentralTestHooks): the console's tRPC router and a real engineer session */
const hooks: CentralTestHooks = {
  async trpcRouter() {
    const [{ router }, { robotRouter }] = await Promise.all([import("../../_core/trpc"), import("../../routers/robotRouter")]);
    return router({ robot: robotRouter });
  },
  async mintSession(sql, userId, openId) {
    const { sdk } = await import("../../_core/sdk");
    const t = await sdk.signSession({ openId, appId: "f1-e2e", name: "F1 engineer" }, { expiresInMs: 60 * 60 * 1000 });
    await sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${userId}, ${t}, now() + interval '1 hour', true)`;
    return t;
  },
};

describe.skipIf(!onTest)("doc 81 Đợt 9 S4 (v2) — central + edge in two processes over HTTP, the edge with no DB (_test)", () => {
  beforeAll(async () => {
    c = await setupCentral("S4V2", { hooks });
    edge = await c.spawnEdge("s4");
    await c.clearEdgeLock(c.ids.robotA, edge);
  }, 300_000);
  afterAll(async () => {
    c?.setMode("up");
    await c?.teardown();
  }, 240_000);

  it("★ assign → pull → claim (signed package) → run → complete: the EDGE process walks the run (gate approved centrally), its robot gets the motion and the STOP", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const id = await c.startRun("complete", [s.gate(), s.move("m1"), s.stop("s1")]);
    await c.approveAtGate(id);
    await waitFor("run completed on the edge and reported", async () => (await c.run(id)).status === "completed" && (await c.assignment(id)).claimTokenHash === null, 60_000);
    expect([motions() - m0, stops() - s0]).toEqual([1, 1]);
    expect(await motionRows(id)).toBe(1); // central's ledger row of the motion, written from the edge's report
    const a = await c.assignment(id);
    expect(a.claimSeq).toBe(2); // two segments: up to the gate, then after the approval
    expect(a.claimedByCredentialId).toBe(c.credentialIds.A);
    const steps = await c.stepRows(id);
    expect(steps.map((r) => [r.stepId, r.status])).toEqual([["g0", "completed"], ["m1", "completed"], ["s1", "completed"]]);
    // the claim answer carried a SIGNED run package (typ runpkg) for exactly this run / claim
    const claimAns = c.front.captured.filter((x) => x.path === `/runs/${id}/claim` && x.status === 200).map((x) => x.answer.data.package);
    expect(claimAns.length).toBe(2);
    expect(claimAns.every((p) => p.typ === "avi-edge-runpkg+v1" && JSON.parse(p.payload).runId === id)).toBe(true);
  }, 120_000);

  it("★ abort mid-run: the non-STOP step after the abort is NEVER sent, the STOP is sent by the edge once, the run stays aborted; replays are refused", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const id = await c.startRun("abort", [s.gate(), s.move("m1"), s.delay("d1", 3000), s.move("m2"), s.stop("s1")]);
    await c.approveAtGate(id);
    await edge.waitCounts("m1 sent by the edge", () => motions() === m0 + 1);
    await waitFor("a progress report of the live claim", async () => c.front.captured.some((x) => x.path === `/runs/${id}/progress` && x.status === 200));
    // ── replayed progress (a captured request, sent again): refused, the row never moves back ──
    const last = [...c.front.captured].reverse().find((x) => x.path === `/runs/${id}/progress`)!;
    const before = Number((await c.assignment(id)).progressSeq);
    const replay = await c.post(`/edge/node/runs/${id}/progress`, last.body, c.tokens.A);
    expect(replay.status).toBe(409);
    expect(Number((await c.assignment(id)).progressSeq)).toBeGreaterThanOrEqual(before);
    const claimReq = c.front.captured.find((x) => x.path === `/runs/${id}/claim`)!;
    expect((await c.post(`/edge/node/runs/${id}/claim`, claimReq.body, c.tokens.A)).status).toBe(409);
    // ── the abort ──
    await c.abort(id);
    await edge.waitCounts("the STOP sent by the edge's sweep", () => stops() >= s0 + 1, 15_000);
    await sleep(3_500); // past the end of the 3 s delay: m2 would have been sent by now
    expect(motions()).toBe(m0 + 1);
    expect(stops()).toBe(s0 + 1); // exactly one STOP reached the robot
    await waitFor("the edge reported the segment end", async () => (await c.assignment(id)).claimTokenHash === null, 15_000);
    expect((await c.run(id)).status).toBe("aborted");
    await waitFor("abort:s1 confirmed", async () => (await c.stepRows(id)).find((r) => r.stepId === "abort:s1")?.status === "completed", 15_000);
    // v2: central never sent a motion / STOP of its own to the edge-owned robot (no central session; ROBOT_OWNED_BY_EDGE)
    // central's OWN sweep tried too (no session for an edge-owned robot ⇒ its row is NOT done) — and that failure never shows the
    // STOP the edge confirmed as failed: abort:s1 above is completed, and exactly one STOP reached the robot
    const centralTries = await c.sql`SELECT status FROM robot_jobs WHERE "robotId" = ${c.ids.robotA} AND "idempotencyKey" LIKE ${`run${id}-abort-%`}`;
    expect(centralTries.map((r) => r.status).filter((st) => st === "done")).toEqual([]);
    // ── a captured "complete", replayed: the claim is gone ──
    const done = c.front.captured.find((x) => x.path === `/runs/${id}/complete`)!;
    expect((await c.post(`/edge/node/runs/${id}/complete`, done.body, c.tokens.A)).status).toBe(409);
    expect((await c.run(id)).status).toBe("aborted"); // never resurrected
  }, 120_000);

  let pausedAbortRun = { id: 0, s0: 0 };
  it("★ L-7 across processes: aborted while PAUSED after actuating — central has no session for the robot, the EDGE re-sends the STOP from the signed sweep picture (its confirmation: BUG F1-4)", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const id = await c.startRun("pausedAbort", [s.gate(), s.move("m1"), s.gate("g1"), s.stop("s1")]);
    await c.approveAtGate(id);
    await waitFor("m1 sent and the run paused at g1 on the edge", async () => (await c.run(id)).status === "awaiting_confirm" && motions() === m0 + 1 && (await c.assignment(id)).claimTokenHash === null, 30_000);
    await c.abort(id);
    await edge.waitCounts("the STOP re-sent by the edge", () => stops() >= s0 + 1, 20_000);
    const picture = c.front.captured.filter((x) => x.path === "/pull" && x.answer?.data?.stopsUnconfirmed?.some((u: { runId: number }) => u.runId === id));
    expect(picture.length).toBeGreaterThan(0);
    expect(picture[0].answer.data.stopsUnconfirmed.find((u: { runId: number }) => u.runId === id).picture.typ).toBe("avi-edge-runpkg+v1"); // signed
    expect(motions()).toBe(m0 + 1); // m1 never repeated
    expect((await c.run(id)).status).toBe("aborted");
    pausedAbortRun = { id, s0 };
  }, 120_000);
  // BUG F1-4 (found here, NOT fixed — routed). Đợt 9 proved "re-sent once, then confirmed: not again". In v2 a STOP the edge
  // re-sends from a sweep picture (run aborted while PAUSED: no claim, no run stream) is reported only as an `events` record
  // `{kind:"stop", source:"local", requestId:null}` (edge/edgeExecutionAgent.ts:1030-1036), which central only audits
  // (edge/edgeReportsCentral.ts:482-487, EDGE_STOP_SENT) — nothing ever confirms abort:<step>. Measured: abort:s1 stays
  // `failed` ("robot not active/connected", central's own attempt), the pull keeps listing the run in stopsUnconfirmed and the edge
  // re-sends the STOP every EDGE_STOP_RESEND_MIN_MS (20 STOPs in 20 s at 1 s), until the picture window ends. L-7 holds (the STOP
  // goes out), but the operator sees the STOP as failed and the robot gets a STOP storm. it.fails asserts the Đợt 9 outcome.
  it.fails("BUG F1-4 — a STOP re-sent from a sweep picture is confirmed centrally (abort:s1 completed) and not sent again", async () => {
    expect(pausedAbortRun.id).toBeGreaterThan(0);
    await waitFor("abort:s1 confirmed", async () => (await c.stepRows(pausedAbortRun.id)).find((r) => r.stepId === "abort:s1")?.status === "completed", 10_000);
    await sleep(2_000);
    expect(stops()).toBe(pausedAbortRun.s0 + 1);
  }, 60_000);

  it("★ out-of-scope node: B sees nothing of A's runs and its answers equal 'missing'; A never takes a run assigned to B", async () => {
    const forB = await c.startRun("forB", [c.steps.gate(), c.steps.move("m1", c.ids.robotB)], "B");
    const forA = await c.startRun("forA", [c.steps.gate(), c.steps.move("m1")]);
    const pulledB = await c.post("/edge/node/pull", {}, c.tokens.B);
    expect(pulledB.json.data.runs.map((r: { runId: number }) => r.runId)).toEqual([forB]);
    const asB = await c.post(`/edge/node/runs/${forA}/claim`, { claimSeq: 0, defHash: "a".repeat(64), programChecks: [] }, c.tokens.B);
    const missing = await c.post(`/edge/node/runs/2000000000/claim`, { claimSeq: 0, defHash: "a".repeat(64), programChecks: [] }, c.tokens.B);
    expect(asB.status).toBe(404);
    expect(JSON.stringify(asB.json).replace(String(forA), "N")).toBe(JSON.stringify(missing.json).replace("2000000000", "N"));
    await sleep(1_500); // ~7 pull cycles of A's edge
    expect((await c.run(forB)).status).toBe("queued");
    expect((await c.assignment(forB)).claimSeq).toBe(0);
    await c.approveAtGate(forA); // A did take its own run meanwhile
    await c.abort(forA);
  }, 90_000);

  it("★ offline: no new run is claimed; the walking run's next NON-STOP step is never sent; a central abort written while offline reaches the edge on reconnect and its STOP goes out", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const walking = await c.startRun("offlineWalk", [s.gate(), s.move("m1"), s.delay("d1", 3000), s.move("m2"), s.stop("s1")]);
    await c.approveAtGate(walking);
    await edge.waitCounts("m1 sent by the edge", () => motions() === m0 + 1);
    c.setMode("drop");
    let fresh = 0;
    try {
      fresh = await c.startRun("offlineNew", [s.gate(), s.move("m1")]);
      await c.abort(walking); // written to the run row; no HTTP answer can carry it now
      await sleep(4_500);
      expect(motions()).toBe(m0 + 1); // m2 never sent (its authorisation cannot be obtained)
      expect((await c.run(fresh)).status).toBe("queued"); // nothing new started offline
      expect((await c.assignment(fresh)).claimSeq).toBe(0);
    } finally {
      c.setMode("up");
    }
    await edge.waitCounts("the walking run's STOP sent once central's abort is known", () => stops() >= s0 + 1, 30_000);
    await waitFor("the fresh run claimed once central is back", async () => (await c.run(fresh)).status === "awaiting_confirm", 30_000);
    await c.abort(fresh);
    expect((await c.run(walking)).status).toBe("aborted");
    expect(motions()).toBe(m0 + 1);
  }, 120_000);

  it("★ credential revoked: the node can take nothing more (pull 401), its run stays queued; every motion central recorded came from the EDGE process, which never touched the DB", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const { runEdgeCredentialCli } = await import("../../../scripts/edge-node-credential");
    const code = await runEdgeCredentialCli(["revoke", "--node", c.codes.nodeA, "--actor", c.adminLogin.username, "--reason", "node decommissioned"], {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      env: {},
      promptSecret: async (label) => (/password/i.test(label) ? c.adminLogin.password : null),
    });
    expect(code, err.join(" | ")).toBe(0);
    expect((await c.post("/edge/node/pull", {}, c.tokens.A)).status).toBe(401);
    const id = await c.startRun("revoked", [c.steps.gate(), c.steps.move("m1")]);
    await sleep(2_000); // ~10 pull cycles
    expect((await c.run(id)).status).toBe("queued");
    expect((await c.assignment(id)).claimSeq).toBe(0);
    const report = await edge.stop();
    expect(report.pid).not.toBe(process.pid);
    expect(noDbEvidence(report)).toEqual({ trap: 0, pgConnects: 0, pgConstructed: 0, probe: "EDGE_DB_TRAP", removedFromEnv: ["DATABASE_URL"] });
    const rows = Number((await c.sql`SELECT count(*)::int AS n FROM robot_jobs WHERE "robotId" = ${c.ids.robotA} AND status = 'done' AND "jobType" = 'custom'`)[0].n);
    expect(report.motions.filter((m) => m.robotId === c.ids.robotA).length).toBe(rows); // every motion the DB says was done came from the EDGE process's robot
  }, 120_000);
});
